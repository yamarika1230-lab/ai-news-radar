import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import type { RawArticle, ProcessedArticle, TrendingKeyword } from "./types";

// ---------------------------------------------------------------------------
// Azure AI 経由の Anthropic クライアント
// ---------------------------------------------------------------------------
console.log("[Summarizer] baseURL:", process.env.ANTHROPIC_BASE_URL);
console.log("[Summarizer] apiKey exists:", !!process.env.ANTHROPIC_API_KEY);

const client = new Anthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL,
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = "claude-sonnet-4-5";
const BATCH_SIZE = 20;

// ---------------------------------------------------------------------------
// システムプロンプト
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `あなたは、大手コンサルティングファームのAIリサーチアナリストです。
以下の記事データを分析し、コンサルタントがクライアントへの提案に
活用できる実践的なインテリジェンスを抽出してください。

■ 選定基準（重要度順）

1. 企業のAI導入・活用事例（最優先）
   - 国内外の企業がAIを導入して業務を改善した具体的な事例
   - 「どの企業が」「何の業務に」「どのAIを」「どう活用して」「どんな成果を得たか」
     が分かる記事を最も高くスコアリング

2. 主要AIモデル・プラットフォームの重要アップデート
   - Claude, GPT, Gemini, Llama 等の新バージョン・新機能
   - Azure AI, AWS Bedrock, Google Cloud Vertex AI 等のプラットフォーム更新

3. 実務で使えるAIツール・ソリューション
   - ワークフローを具体的に改善・効率化するツール

4. AI業界の戦略的動向
   - 大型の資金調達、M&A、戦略提携、規制・ガバナンス

■ カテゴリ分類
- "enterprise": 企業のAI導入・活用事例、業界動向（最重要カテゴリ）
- "llm": LLMモデルの新規リリース、アップデート、ベンチマーク比較
- "tools": AIツール、サービス、フレームワークの実務活用
- "tips": AIの具体的な活用方法、プロンプト技術、業務効率化のノウハウ
- "other": 上記に該当しないAI関連ニュース

■ スコアリング基準（0-100の整数、必ず1以上を返すこと）
- クライアント提案への活用度（40%）
- 具体性・実用性（25%）
- 速報性・新規性（20%）
- 業界への影響度（15%）

PR TIMES、日経クロステック、Google News の企業AI導入事例は enterprise で70以上。
arXivの学術論文で実務応用不明確なものは50以下。

■ 出力形式
各記事について以下のJSON形式で返してください:

- title: 日本語のタイトル（★絶対に日本語で出力すること。英語のタイトルは禁止★）
  英語の記事は自然な日本語に翻訳する。固有名詞（Claude, GPT等）は英語のままでOK。
  悪い例: "Thinking In The Agent Age"
  良い例: "OpenAI、エージェント型AIの新フレームワークを発表"
- summary: 日本語の要約（150-250文字）
- category: 上記カテゴリのいずれか
- score: 総合スコア（1-100の整数）
- originalLanguage: "en" または "ja" または "other"

出力は純粋なJSONのみ。`;

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function generateId(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 12);
}

const VALID_CATEGORIES = [
  "llm",
  "tools",
  "enterprise",
  "tips",
  "other",
] as const;

function validateCategory(
  cat?: string,
): ProcessedArticle["category"] {
  return (
    VALID_CATEGORIES.find((v) => v === cat?.toLowerCase()) ?? "other"
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/** JSON配列を堅牢にパース */
function parseClaudeResponse(text: string): unknown[] {
  // 1. 直接パース
  try {
    const direct = JSON.parse(text);
    if (Array.isArray(direct)) return direct;
  } catch { /* fall through */ }

  // 2. ```json ... ``` ブロック
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fall through */ }
  }

  // 3. [...] を探す
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fall through */ }
  }

  console.log(
    "[Summarizer] JSON parse completely failed. Raw text:",
    text.substring(0, 500),
  );
  return [];
}

/** タイトルとソースからカテゴリを簡易推定 */
function guessCategory(article: RawArticle): ProcessedArticle["category"] {
  const text = `${article.title} ${article.content}`.toLowerCase();
  if (text.match(/導入|活用|採用|enterprise|業務|production|deploy|事例/))
    return "enterprise";
  if (text.match(/gpt|claude|gemini|llama|model|benchmark|パラメータ|リリース/))
    return "llm";
  if (text.match(/tool|ツール|sdk|api|framework|launch|オープンソース/))
    return "tools";
  if (text.match(/tips|プロンプト|使い方|tutorial|how to|活用法/))
    return "tips";
  return "other";
}

/** スコアを簡易推定 */
function guessScore(article: RawArticle): number {
  let score = 50;
  if (article.score && article.score > 100) score += 15;
  else if (article.score && article.score > 10) score += 5;
  if (article.comments && article.comments > 50) score += 10;
  if (article.source === "Google News" || article.source === "PR TIMES (AI)")
    score += 10;
  if (article.source === "arXiv") score -= 10;
  return Math.min(100, Math.max(1, score));
}

/** API失敗時のフォールバック（カテゴリ・スコア推定付き） */
function toFallback(article: RawArticle): ProcessedArticle {
  return {
    id: generateId(article.url),
    title: article.title,
    url: article.url,
    source: article.source,
    summary: "",
    category: guessCategory(article),
    score: guessScore(article),
    publishedAt: article.publishedAt,
    collectedAt: new Date().toISOString(),
    originalLanguage: /^[A-Za-z]/.test(article.title) ? "en" : "ja",
  };
}

// ---------------------------------------------------------------------------
// バッチ処理
// ---------------------------------------------------------------------------

function buildArticlesText(
  batch: RawArticle[],
  offset: number,
): string {
  return batch
    .map((a, i) => {
      const idx = offset + i;
      const lines = [
        `[${idx}] ${a.title}`,
        `URL: ${a.url}`,
        `Source: ${a.source}`,
      ];
      if (a.content) lines.push(`Content: ${a.content.slice(0, 300)}`);
      if (a.score !== undefined) lines.push(`Score: ${a.score}`);
      if (a.comments !== undefined)
        lines.push(`Comments: ${a.comments}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

interface ClaudeResult {
  index: number;
  title: string;
  summary: string;
  category: string;
  score: number;
  originalLanguage?: string;
}

async function processBatch(
  batch: RawArticle[],
  offset: number,
): Promise<ProcessedArticle[]> {
  const articlesText = buildArticlesText(batch, offset);

  const userPrompt = `以下の ${batch.length} 件の記事を分析してください。
indexフィールドには各記事の番号をそのまま使用してください。
★重要: titleは絶対に日本語で出力すること。英語の記事タイトルを翻訳すること。
★重要: scoreは1-100の整数を返すこと。categoryはenterprise/llm/tools/tips/otherのいずれか。

記事一覧:
${articlesText}

JSON配列のみを返してください。形式:
[{"index":${offset},"title":"日本語タイトル","summary":"日本語要約","category":"enterprise","score":75,"originalLanguage":"en"}, ...]`;

  try {
    console.log(
      `[Summarizer] API呼び出し開始: model=${MODEL}, batch offset=${offset}, count=${batch.length}`,
    );

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    console.log("[Summarizer] API response received");

    const block = message.content[0];
    if (block.type !== "text") {
      console.log(
        `[Summarizer] バッチ offset=${offset}: text以外のレスポンス type=${block.type}`,
      );
      return batch.map((a) => toFallback(a));
    }

    const responseText = block.text.trim();
    console.log(
      `[Summarizer] response text (first 300 chars): ${responseText.substring(0, 300)}`,
    );

    // JSON パース
    console.log("[Summarizer] attempting to parse JSON...");
    const results = parseClaudeResponse(responseText) as ClaudeResult[];

    if (results.length === 0) {
      console.log("[Summarizer] parse returned 0 results — using fallback");
      return batch.map((a) => toFallback(a));
    }

    console.log(`[Summarizer] parsed ${results.length} articles`);

    return batch.map((article, i) => {
      const idx = offset + i;
      const info = results.find((r) => r.index === idx);

      const score = info?.score ?? guessScore(article);
      const lang = info?.originalLanguage?.toLowerCase();
      const originalLanguage: ProcessedArticle["originalLanguage"] =
        lang === "en" ? "en" : lang === "ja" ? "ja" : "other";

      return {
        id: generateId(article.url),
        title: info?.title ?? article.title,
        url: article.url,
        source: article.source,
        summary: info?.summary ?? "",
        category: validateCategory(info?.category) !== "other"
          ? validateCategory(info?.category)
          : guessCategory(article),
        score: Math.min(100, Math.max(1, score)),
        publishedAt: article.publishedAt,
        collectedAt: new Date().toISOString(),
        originalLanguage,
      };
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.log(`[Summarizer] バッチ offset=${offset} 処理失敗:`, errMsg);
    console.log("[Summarizer] フォールバックでカテゴリ・スコア推定を使用");
    return batch.map((a) => toFallback(a));
  }
}

// ---------------------------------------------------------------------------
// メインエクスポート: summarizeAndClassify
// ---------------------------------------------------------------------------

export async function summarizeAndClassify(
  rawArticles: RawArticle[],
): Promise<ProcessedArticle[]> {
  if (rawArticles.length === 0) return [];

  console.log(
    `[Summarizer] ${rawArticles.length}件を${BATCH_SIZE}件ずつ処理開始`,
  );
  console.log(
    `[Summarizer] 環境変数確認 — baseURL: ${process.env.ANTHROPIC_BASE_URL ?? "未設定"}, apiKey: ${process.env.ANTHROPIC_API_KEY ? "設定済み" : "未設定"}`,
  );

  const batches = chunk(rawArticles, BATCH_SIZE);
  const results: ProcessedArticle[] = [];

  for (let b = 0; b < batches.length; b++) {
    const offset = b * BATCH_SIZE;
    console.log(
      `[Summarizer] バッチ ${b + 1}/${batches.length} (${batches[b].length}件)`,
    );
    const processed = await processBatch(batches[b], offset);
    results.push(...processed);
  }

  // 統計ログ
  const catCounts: Record<string, number> = {};
  let scoreSum = 0;
  for (const a of results) {
    catCounts[a.category] = (catCounts[a.category] ?? 0) + 1;
    scoreSum += a.score;
  }
  console.log(
    `[Summarizer] 処理完了: ${results.length}件, 平均スコア=${(scoreSum / results.length).toFixed(0)}, カテゴリ=${JSON.stringify(catCounts)}`,
  );

  return results;
}

// ---------------------------------------------------------------------------
// メインエクスポート: extractTrendingKeywords
// ---------------------------------------------------------------------------

const TRENDING_SYSTEM_PROMPT = `あなたはAI/テクノロジーニュースのアナリストです。
与えられた記事のタイトルと要約からトレンドキーワードを抽出してください。

以下の条件で上位10件を抽出:
- 技術用語、プロダクト名、企業名、コンセプト名を対象
- 一般的すぎる単語（AI, tech, new 等）は除外
- change: 前日比の変化率を推定（仮値でOK）
- hot: 特に注目度が高いものは true

出力は純粋なJSONのみ。`;

export async function extractTrendingKeywords(
  articles: ProcessedArticle[],
): Promise<TrendingKeyword[]> {
  if (articles.length === 0) return [];

  const inputText = articles
    .map(
      (a, i) =>
        `[${i}] ${a.title}\n要約: ${a.summary}\nScore: ${a.score}`,
    )
    .join("\n\n");

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: TRENDING_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `以下の${articles.length}件の記事からトレンドキーワードを抽出してください。

${inputText}

JSON配列のみを返してください。形式:
[{"keyword":"...","change":"+N%","hot":true}, ...]`,
        },
      ],
    });

    const block = message.content[0];
    if (block.type !== "text") return [];

    const parsed = parseClaudeResponse(block.text.trim());
    return (parsed as TrendingKeyword[])
      .filter(
        (k) =>
          typeof k.keyword === "string" &&
          typeof k.change === "string" &&
          typeof k.hot === "boolean",
      )
      .slice(0, 10);
  } catch (error) {
    console.log("[Summarizer] トレンドキーワード抽出失敗:", error);
    return [];
  }
}
