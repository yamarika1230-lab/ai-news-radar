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
const SYSTEM_PROMPT = `あなたはAIニュースの編集者です。以下の記事データを分析し、
各記事について以下の情報をJSON形式で返してください。

各記事について:
- title: 日本語のタイトル（元が英語の場合は自然な日本語に翻訳）
- summary: 日本語の要約（100-200文字。要点を簡潔に）
- category: 以下のいずれかに分類
  - "llm": LLMモデルの新規リリース、アップデート、ベンチマーク比較
  - "tools": AIツール、サービス、フレームワークの新規・更新
  - "enterprise": 企業・業界でのAI活用事例
  - "tips": AIの便利な活用方法、チュートリアル、プロンプト技術
  - "other": 上記に該当しないAI関連ニュース
- score: 関連度・注目度スコア（0-100の整数）
  以下の基準で採点:
  - ソーシャルでの反応（スコア/コメント数）: 30%
  - 速報性・新規性: 30%
  - 実務での有用性: 20%
  - 業界への影響度: 20%

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
