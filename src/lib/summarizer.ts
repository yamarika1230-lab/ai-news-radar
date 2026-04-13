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
const BATCH_SIZE = 8;

// ---------------------------------------------------------------------------
// システムプロンプト
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `【最優先ルール — 例外なし】
全ての記事の"title"と"summary"は、必ず日本語で出力してください。

以下は絶対に禁止:
- 英語のタイトルをそのまま返すこと
- 中国語のタイトルをそのまま返すこと
- 翻訳せずに原文を返すこと

必ず自然な日本語に翻訳してから返してください。
固有名詞（Google, OpenAI, Claude, GPT, GitHub等）は英語のままでOKです。
それ以外の部分は全て日本語にしてください。

翻訳例:
- "Alibaba bets $290M on world models" → "アリババ、ワールドモデルに2.9億ドルを投資"
- "数字生命KKKKhazix AI Skills合集" → "中国発AIスキル集がGitHubで注目 — 1400スター獲得"
- "Act Wisely: Cultivating Meta-Cognitive Tool Use" → "AIエージェントのメタ認知ツール活用を育成する新手法"

良い例:
- "Instant 1.0, a backend for AI-coded apps" → "Instant 1.0 — AIコーディングアプリ向け新バックエンドが登場"
- "Generative AI as a weapon of war in Iran" → "イラン紛争で生成AIが兵器として利用される実態が明らかに"
- "27 questions to ask when choosing an LLM" → "LLM選定時に確認すべき27の重要チェックポイント"
- "Google's TurboQuant reduces AI LLM cache memory..." → "Google、LLMキャッシュメモリを6分の1に削減する新技術TurboQuantを発表"
- "Show HN: Open source alternative to Cursor" → "Cursorのオープンソース代替ツールが登場 — HackerNewsで話題に"

固有名詞（Google, OpenAI, Claude, GPT等）は英語のままでOK。それ以外は全て日本語。

あなたは大手コンサルティングファームのAIリサーチアナリストです。

■ カテゴリ分類
- "enterprise": 企業のAI導入・活用事例、業界動向（最重要）
- "llm": LLMモデルの新規リリース、アップデート、ベンチマーク
- "tools": AIツール、サービス、フレームワークの実務活用
- "tips": AI活用方法、プロンプト技術、業務効率化ノウハウ
- "other": 上記に該当しないAI関連ニュース

■ スコアリング基準（1-100の整数。必ず1以上。50は使わないこと）
- クライアント提案への活用度（40%）
- 具体性・実用性（25%）
- 速報性・新規性（20%）
- 業界への影響度（15%）
PR TIMES / 日経クロステック / Google News の企業AI事例は enterprise で70以上。
arXiv論文で実務応用不明確なものは40以下。

■ "enterprise"カテゴリの具体例
(A) AI企業自体のニュース:
  - 「OpenAIが企業価値8520億ドルで1220億ドルの資金調達ラウンドを完了」
(B) 一般企業のAI活用ニュース（特に重視、スコア75以上）:
  - 「InsurifyやTuioがChatGPTで保険比較・購入をできるようにした」
  - 「第一生命HD、仮想顧客で保険開発　AI実証へ」
  - 「DeNA AI Link、AI駆動開発で最大82%の工数削減を実現」
  - 「ソフトバンク、AI投資と経済圏強化で差別化へ」

■ 出力形式（JSON配列のみ）
- index: 記事の番号（整数）
- title: 日本語タイトル（英語禁止）
- summary: 日本語要約（150-250文字）
- category: カテゴリ
- score: 総合スコア（1-100、50は不可）
- originalLanguage: "en" / "ja" / "other"

【出力形式の注意】
レスポンスは純粋なJSON配列のみを返してください。
マークダウンのコードブロック（\`\`\`json や \`\`\`）で囲まないでください。
[ で始まり ] で終わるJSON配列をそのまま返してください。`;

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
  let cleaned = text.trim();

  // Step 1: ```json ... ``` を除去
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/;
  const match = cleaned.match(codeBlockRegex);
  if (match) {
    cleaned = match[1].trim();
    console.log("[Summarizer] コードブロック除去成功, 長さ:", cleaned.length);
  }

  // Step 2: [ ] の範囲を特定
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    cleaned = cleaned.substring(firstBracket, lastBracket + 1);
  }

  // Step 2.5: JSON内の制御文字をエスケープ
  cleaned = cleaned.replace(/[\x00-\x1f\x7f]/g, (ch) => {
    if (ch === "\n" || ch === "\r" || ch === "\t") return ch;
    return " ";
  });

  // Step 3: パース試行
  try {
    const result = JSON.parse(cleaned);
    if (Array.isArray(result) && result.length > 0) {
      console.log("[Summarizer] パース成功:", result.length, "件");
      return result;
    }
  } catch (e) {
    console.log("[Summarizer] パースエラー:", (e as Error).message);
  }

  // Step 4: JSONが途中で切れている場合の修復
  try {
    const lastBrace = cleaned.lastIndexOf("}");
    if (lastBrace > 0) {
      const start = cleaned.indexOf("[");
      if (start !== -1) {
        const repaired = cleaned.substring(start, lastBrace + 1) + "]";
        const result = JSON.parse(repaired);
        if (Array.isArray(result) && result.length > 0) {
          console.log("[Summarizer] 修復パース成功:", result.length, "件");
          return result;
        }
      }
    }
  } catch { /* fall through */ }

  // Step 5: 個別オブジェクト抽出（壊れたJSON内から有効なオブジェクトを回収）
  try {
    const objectPattern = /\{[^{}]*"index"\s*:\s*\d+[^{}]*\}/g;
    const matches = cleaned.match(objectPattern);
    if (matches && matches.length > 0) {
      const recovered: unknown[] = [];
      for (const objStr of matches) {
        try {
          const obj = JSON.parse(objStr) as Record<string, unknown>;
          if (obj.index !== undefined && obj.title) {
            recovered.push(obj);
          }
        } catch { /* skip */ }
      }
      if (recovered.length > 0) {
        console.log("[Summarizer] 個別オブジェクト修復成功:", recovered.length, "件");
        return recovered;
      }
    }
  } catch { /* fall through */ }

  console.log("[Summarizer] 全パース失敗, フォールバックへ. 先頭200:", cleaned.substring(0, 200));
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

/** タイトルが英語/中国語のみの場合に簡易的な日本語表示を生成 */
function translateTitleSimple(title: string, source?: string): string {
  const hasHiraganaKatakana = /[\u3040-\u309f\u30a0-\u30ff]/.test(title);
  if (hasHiraganaKatakana) return title; // 日本語を含む→そのまま

  // 漢字のみ（中国語の可能性）
  const hasKanjiOnly = /[\u4e00-\u9fff]/.test(title) && !hasHiraganaKatakana;
  if (hasKanjiOnly) return `【中国語】${title}`;

  // GitHub リポジトリ名（user/repo形式）
  if (/^[\w.-]+\/[\w.-]+$/.test(title)) {
    const repoName = (title.split("/").pop() || title).replace(/[-_]/g, " ");
    return `GitHub: ${repoName}（AI関連リポジトリ）`;
  }

  // GitHub リポジトリ名 + 説明
  if (source === "GitHub" && /^[\w.-]+\/[\w.-]+:/.test(title)) {
    const parts = title.split(":");
    const repoName = (parts[0].split("/").pop() || parts[0]).replace(/[-_]/g, " ");
    const desc = parts.slice(1).join(":").trim();
    return `GitHub: ${repoName} — ${desc || "AI関連リポジトリ"}`;
  }

  // "Show HN:" プレフィックス
  if (title.startsWith("Show HN:")) {
    return title.replace("Show HN:", "HN注目:") + "（※英語記事）";
  }

  // その他の英語タイトル
  return `【英語】${title}`;
}

/** API失敗時のフォールバック */
function toFallback(article: RawArticle): ProcessedArticle {
  return {
    id: generateId(article.url),
    title: translateTitleSimple(article.title, article.source),
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
      if (a.comments !== undefined) lines.push(`Comments: ${a.comments}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

interface ClaudeResult {
  index: number | string;
  title: string;
  summary: string;
  category: string;
  score: number | string;
  originalLanguage?: string;
}

async function processBatch(
  batch: RawArticle[],
  offset: number,
): Promise<ProcessedArticle[]> {
  const articlesText = buildArticlesText(batch, offset);

  const userPrompt = `以下の ${batch.length} 件の記事を分析してください。
indexフィールドには各記事の番号（整数）をそのまま使用してください。
★絶対に: titleは日本語で出力。英語のタイトルは翻訳すること。
★絶対に: scoreは1-100の整数。categoryはenterprise/llm/tools/tips/otherのいずれか。

記事一覧:
${articlesText}

JSON配列のみを返してください。形式:
[{"index":${offset},"title":"日本語タイトル","summary":"日本語要約","category":"enterprise","score":75,"originalLanguage":"en"}, ...]`;

  try {
    console.log(
      `[Summarizer] API呼び出し: model=${MODEL}, offset=${offset}, count=${batch.length}`,
    );

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    console.log("[Summarizer] API response received");

    const block = message.content[0];
    if (block.type !== "text") {
      console.log(`[Summarizer] text以外のレスポンス: ${block.type}`);
      return batch.map((a) => toFallback(a));
    }

    const responseText = block.text.trim();
    console.log(
      `[Summarizer] response text (first 500 chars): ${responseText.substring(0, 500)}`,
    );

    const results = parseClaudeResponse(responseText) as ClaudeResult[];

    if (results.length === 0) {
      console.log("[Summarizer] parse returned 0 — using fallback");
      return batch.map((a) => toFallback(a));
    }

    console.log(`[Summarizer] parsed ${results.length} articles`);

    // デバッグ: 最初の1件をフル出力
    if (results.length > 0) {
      console.log(
        `[Summarizer] サンプル記事: ${JSON.stringify(results[0])}`,
      );
    }

    // index マッチング: 位置ベースのフォールバック付き
    return batch.map((article, i) => {
      const idx = offset + i;

      // indexの型が string/number どちらでもマッチ
      let info = results.find(
        (r) => Number(r.index) === idx,
      );

      // indexマッチに失敗した場合、配列位置でマッチ
      if (!info && i < results.length) {
        info = results[i];
        if (info && i === 0) {
          console.log(
            `[Summarizer] index不一致 — 位置ベースマッチにフォールバック (idx=${idx}, result.index=${info.index})`,
          );
        }
      }

      const score = info?.score != null ? Number(info.score) : guessScore(article);
      const category = info?.category
        ? validateCategory(info.category)
        : guessCategory(article);
      const lang = info?.originalLanguage?.toLowerCase();
      const originalLanguage: ProcessedArticle["originalLanguage"] =
        lang === "en" ? "en" : lang === "ja" ? "ja" : "other";

      const claudeTitle = info?.title;
      const finalTitle = claudeTitle || article.title;

      // 英語タイトルが残存した場合をログ出力
      if (
        finalTitle &&
        !/[\u3000-\u9fff\u30A0-\u30FF\u3040-\u309F]/.test(finalTitle)
      ) {
        console.log(
          `[Summarizer] 英語タイトル残存: "${finalTitle.substring(0, 60)}" ← Claude: ${claudeTitle ? `"${claudeTitle.substring(0, 60)}"` : "なし"}`,
        );
      }

      return {
        id: generateId(article.url),
        title: finalTitle,
        url: article.url,
        source: article.source,
        summary: info?.summary ?? "",
        category,
        score: Math.min(100, Math.max(1, score || 50)),
        publishedAt: article.publishedAt,
        collectedAt: new Date().toISOString(),
        originalLanguage,
      };
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.log(`[Summarizer] parse error: ${errMsg}`);
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

  const batches = chunk(rawArticles, BATCH_SIZE);
  const results: ProcessedArticle[] = [];
  const summarizerStart = Date.now();
  const SUMMARIZER_TIMEOUT = 260_000; // 260秒（Vercel 300秒制限内）

  for (let b = 0; b < batches.length; b++) {
    // タイムアウトチェック
    if (Date.now() - summarizerStart > SUMMARIZER_TIMEOUT) {
      console.log(
        `[Summarizer] タイムアウト接近（${((Date.now() - summarizerStart) / 1000).toFixed(0)}秒）、残り${batches.length - b}バッチをフォールバック処理`,
      );
      // 残りはフォールバック
      for (let r = b; r < batches.length; r++) {
        results.push(...batches[r].map((a) => toFallback(a)));
      }
      break;
    }

    const offset = b * BATCH_SIZE;
    console.log(
      `[Summarizer] バッチ ${b + 1}/${batches.length} (${batches[b].length}件)`,
    );
    const processed = await processBatch(batches[b], offset);

    const successCount = processed.filter((a) => a.summary.length > 0).length;
    const fallbackCount = processed.length - successCount;
    console.log(
      `[Summarizer] バッチ ${b + 1}: Claude成功 ${successCount}件, フォールバック ${fallbackCount}件`,
    );

    results.push(...processed);
  }

  // 未翻訳記事の再翻訳（Claude API で個別リトライ）
  const untranslated = results.filter(
    (a) =>
      !/[\u3040-\u309f\u30a0-\u30ff]/.test(a.title) &&
      !a.title.startsWith("【英語】") &&
      !a.title.startsWith("【中国語】"),
  );

  if (untranslated.length > 0 && untranslated.length <= 20) {
    console.log(
      `[Summarizer] 未翻訳記事の翻訳リトライ: ${untranslated.length}件`,
    );
    try {
      // タイトルだけの軽量リクエスト（番号付きリストで返させる）
      const titleList = untranslated
        .map((a, i) => `${i}. ${a.title}`)
        .join("\n");

      const retryMsg = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: `以下の記事タイトルを全て日本語に翻訳してください。
固有名詞（Google, OpenAI, Claude, GPT等）は英語のままでOK。
同じ番号付きリスト形式で返してください。コードブロックで囲まないでください。

${titleList}`,
          },
        ],
      });

      const retryText =
        retryMsg.content[0].type === "text" ? retryMsg.content[0].text : "";
      console.log(
        `[Summarizer] リトライ結果先頭200: ${retryText.substring(0, 200)}`,
      );

      // 番号付きリストから翻訳結果を抽出
      const lines = retryText.split("\n").filter((l) => l.trim());
      let matched = 0;
      for (let i = 0; i < Math.min(lines.length, untranslated.length); i++) {
        const translated = lines[i].replace(/^\d+\.\s*/, "").trim();
        if (
          translated &&
          /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/.test(translated)
        ) {
          untranslated[i].title = translated;
          matched++;
        }
      }
      console.log(`[Summarizer] リトライ翻訳反映: ${matched}件`);
    } catch (e) {
      console.log(
        "[Summarizer] 翻訳リトライ失敗:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  // 最終チェック: まだ残っている英語/中国語タイトルに接頭辞を付ける
  for (const article of results) {
    if (!/[\u3040-\u309f\u30a0-\u30ff]/.test(article.title)) {
      article.title = translateTitleSimple(article.title, article.source);
    }
  }

  // 統計ログ
  const catCounts: Record<string, number> = {};
  let scoreSum = 0;
  const englishTitleCount = results.filter(
    (a) => !/[\u3000-\u9fff\u30A0-\u30FF\u3040-\u309F]/.test(a.title.replace(/（※英語記事）$/, "")),
  ).length;
  for (const a of results) {
    catCounts[a.category] = (catCounts[a.category] ?? 0) + 1;
    scoreSum += a.score;
  }
  console.log(
    `[Summarizer] 完了: ${results.length}件, 平均スコア=${(scoreSum / results.length).toFixed(0)}, カテゴリ=${JSON.stringify(catCounts)}, 英語タイトル残: ${englishTitleCount}件`,
  );

  return results;
}

// ---------------------------------------------------------------------------
// メインエクスポート: extractTrendingKeywords
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// メインエクスポート: generateRelatedKeywords（Claude APIでAI文脈の関連語生成）
// ---------------------------------------------------------------------------

export async function generateRelatedKeywords(
  keywords: string[],
): Promise<Record<string, { keyword: string; searchUrl: string }[]>> {
  if (keywords.length === 0) return {};

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `以下はAI/テクノロジー分野のトレンドキーワードです。
各キーワードについて、AI・テクノロジー文脈での関連キーワードを5つずつ日本語で生成してください。
一般的な意味ではなく、必ずAI/テクノロジーの文脈に沿った関連語にしてください。

例:
- "RAG" → ["RAG とは", "Retrieval-Augmented Generation", "RAG ベクトルDB", "RAG チャンク分割", "RAG 精度向上"]
- "Claude" → ["Claude 4", "Anthropic", "Claude Code", "Claude API", "Claude vs ChatGPT"]

キーワード: ${keywords.join(", ")}

JSON形式で返してください。コードブロックで囲まないでください:
{"キーワード1":["関連語1","関連語2","関連語3","関連語4","関連語5"],...}`,
        },
      ],
    });

    const block = message.content[0];
    if (block.type !== "text") return {};

    const text = block.text.trim();
    // コードブロック除去
    const cleaned =
      text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)?.[1]?.trim() ?? text;
    // { } を探す
    const braceStart = cleaned.indexOf("{");
    const braceEnd = cleaned.lastIndexOf("}");
    if (braceStart === -1 || braceEnd === -1) return {};

    const data = JSON.parse(
      cleaned.substring(braceStart, braceEnd + 1),
    ) as Record<string, string[]>;

    const result: Record<string, { keyword: string; searchUrl: string }[]> =
      {};
    for (const [kw, related] of Object.entries(data)) {
      if (Array.isArray(related)) {
        result[kw] = related.slice(0, 5).map((r) => ({
          keyword: String(r),
          searchUrl: `https://www.google.com/search?q=${encodeURIComponent(String(r))}`,
        }));
      }
    }

    console.log(
      `[Summarizer] 関連キーワード生成: ${Object.keys(result).length}キーワード分`,
    );
    return result;
  } catch (error) {
    console.log(
      "[Summarizer] 関連キーワード生成失敗:",
      error instanceof Error ? error.message : error,
    );
    return {};
  }
}

// ---------------------------------------------------------------------------
// メインエクスポート: extractTrendingKeywords
// ---------------------------------------------------------------------------

const TRENDING_SYSTEM_PROMPT = `トレンドキーワードを抽出してください。
上位10件、技術用語/プロダクト名/企業名を対象。
出力は純粋なJSON配列のみ。`;

export async function extractTrendingKeywords(
  articles: ProcessedArticle[],
): Promise<TrendingKeyword[]> {
  if (articles.length === 0) return [];

  const inputText = articles
    .map(
      (a, i) => `[${i}] ${a.title}\n要約: ${a.summary}\nScore: ${a.score}`,
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
          content: `以下の${articles.length}件からトレンドキーワードを抽出。
${inputText}

JSON配列で返してください: [{"keyword":"...","change":"+N%","hot":true}, ...]`,
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
