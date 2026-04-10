import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import type { RawArticle, ProcessedArticle, TrendingKeyword } from "./types";

// ---------------------------------------------------------------------------
// Azure AI 経由の Anthropic クライアント
// ---------------------------------------------------------------------------
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
   - 例: 製造業の品質検査、金融のリスク分析、小売の需要予測、医療の画像診断 等

2. 主要AIモデル・プラットフォームの重要アップデート
   - Claude, GPT, Gemini, Llama 等の主要モデルの新バージョン・新機能
   - Azure AI, AWS Bedrock, Google Cloud Vertex AI 等のプラットフォーム更新
   - 企業が「この新機能を使って何ができるようになるか」の観点で要約

3. 実務で使えるAIツール・ソリューション
   - 多くのユーザーのワークフローを具体的に改善・効率化するツール
   - 「〇〇という課題に対し、このツールの新機能を使うことで、
     △△という作業が□□のように変わる」レベルの具体性で記述
   - 単なるUI変更や軽微な機能追加は除外

4. AI業界の戦略的動向
   - 大型の資金調達、M&A、戦略提携
   - 規制・ガバナンスの動向（AI規制法、ガイドライン等）
   - 市場トレンドの変化

■ 除外するもの
- イベント告知、セミナー案内、ウェビナーの募集
- 期間限定の割引、セール、キャンペーン情報
- AIに直接関連しない人事異動や決算発表
- 個人的な意見表明、ポエム的な未来予測
- 学術論文で、実務への応用が不明確なもの

■ カテゴリ分類
各記事を以下のいずれかに分類してください:
- "enterprise": 企業のAI導入・活用事例、業界動向（最重要カテゴリ）
- "llm": LLMモデルの新規リリース、アップデート、ベンチマーク比較
- "tools": AIツール、サービス、フレームワークの実務活用
- "tips": AIの具体的な活用方法、プロンプト技術、業務効率化のノウハウ
- "other": 上記に該当しないAI関連ニュース

■ スコアリング基準（0-100の整数）
以下の基準で総合スコアを採点:
- クライアント提案への活用度（40%）:
  コンサルタントがクライアントに「御社でもこのように活用できます」と
  提案する際のネタになるか
- 速報性・新規性（20%）: 新しい情報か、既知の話題の焼き直しでないか
- 具体性・実用性（25%）:
  「誰が、何に、どう使って、どんな成果」が明確か
- 業界への影響度（15%）: 業界全体のトレンドを左右する規模か

■ 出力形式
各記事について以下のJSON形式で返してください:
- title: 日本語のタイトル（元が英語の場合は自然な日本語に翻訳）
  専門家でなくても重要性が一目でわかる、簡潔で具体的なタイトルにする
- summary: 日本語の要約（150-250文字）
  「誰が/何が、どうなったか」の事実を客観的に記述。
  その結果、ユーザーや企業にどのような具体的な変化や可能性が生まれたかを説明。
  個人的な憶測や長期的な未来予測は不要。
- category: 上記のカテゴリ
- score: 上記基準による総合スコア

出力は純粋なJSONのみ。マークダウンのコードブロックや説明文は含めないでください。`;

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

/** 配列を size 件ずつに分割 */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/** API 呼び出し失敗時のフォールバック変換 */
function toFallback(
  article: RawArticle,
  batchOffset: number,
): ProcessedArticle {
  return {
    id: generateId(article.url),
    title: article.title,
    url: article.url,
    source: article.source,
    summary: "",
    category: "other",
    score: 0,
    publishedAt: article.publishedAt,
    collectedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// バッチ単位の記事テキスト生成
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

// ---------------------------------------------------------------------------
// バッチ1回分の API 呼び出し + パース
// ---------------------------------------------------------------------------

interface ClaudeResult {
  index: number;
  title: string;
  summary: string;
  category: string;
  score: number;
}

async function processBatch(
  batch: RawArticle[],
  offset: number,
): Promise<ProcessedArticle[]> {
  const articlesText = buildArticlesText(batch, offset);

  const userPrompt = `以下の ${batch.length} 件の記事を分析してください。
indexフィールドには各記事の番号をそのまま使用してください。

記事一覧:
${articlesText}

JSON配列のみを返してください。形式:
[{"index":${offset},"title":"...","summary":"...","category":"...","score":0}, ...]`;

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const block = message.content[0];
    if (block.type !== "text") {
      console.log(`[summarizer] バッチ offset=${offset}: text以外のレスポンス`);
      return batch.map((a, i) => toFallback(a, offset + i));
    }

    // JSON を抽出（コードブロックで囲まれていても対応）
    const text = block.text.trim();
    const jsonStr =
      text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() ??
      text.match(/(\[[\s\S]*\])/)?.[1] ??
      text;

    const results: ClaudeResult[] = JSON.parse(jsonStr);

    return batch.map((article, i) => {
      const idx = offset + i;
      const info = results.find((r) => r.index === idx);

      return {
        id: generateId(article.url),
        title: info?.title ?? article.title,
        url: article.url,
        source: article.source,
        summary: info?.summary ?? "",
        category: validateCategory(info?.category),
        score: Math.min(100, Math.max(0, info?.score ?? 0)),
        publishedAt: article.publishedAt,
        collectedAt: new Date().toISOString(),
      };
    });
  } catch (error) {
    console.log(`[summarizer] バッチ offset=${offset} 処理失敗:`, error);
    return batch.map((a, i) => toFallback(a, offset + i));
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
    `[summarizer] ${rawArticles.length}件を${BATCH_SIZE}件ずつ処理開始`,
  );

  const batches = chunk(rawArticles, BATCH_SIZE);
  const results: ProcessedArticle[] = [];

  // バッチを順次処理（API レート制限に配慮）
  for (let b = 0; b < batches.length; b++) {
    const offset = b * BATCH_SIZE;
    console.log(
      `[summarizer] バッチ ${b + 1}/${batches.length} (${batches[b].length}件)`,
    );
    const processed = await processBatch(batches[b], offset);
    results.push(...processed);
  }

  console.log(`[summarizer] 処理完了: ${results.length}件`);
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
- 複合語も可（例: "RAG", "Claude 4", "Apple Intelligence"）
- change: 前日比の変化率を推定（例: "+350%", "+120%", "new"）
  初回はソーシャルスコアやコメント数から推定した仮値でOK
- hot: 特に注目度が高いものは true

出力は純粋なJSONのみ。マークダウンのコードブロックや説明文は含めないでください。`;

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

    const text = block.text.trim();
    const jsonStr =
      text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() ??
      text.match(/(\[[\s\S]*\])/)?.[1] ??
      text;

    const parsed: TrendingKeyword[] = JSON.parse(jsonStr);

    // バリデーション
    return parsed
      .filter(
        (k) =>
          typeof k.keyword === "string" &&
          typeof k.change === "string" &&
          typeof k.hot === "boolean",
      )
      .slice(0, 10);
  } catch (error) {
    console.log(`[summarizer] トレンドキーワード抽出失敗:`, error);
    return [];
  }
}
