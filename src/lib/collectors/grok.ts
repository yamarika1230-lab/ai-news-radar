import type { Collector, RawArticle } from "../types";
import { fetchWithTimeout } from "./utils";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";
const MODEL = "grok-3-mini-fast";
const TIMEOUT_MS = 30_000;

const SEARCH_QUERIES = [
  "AI LLM 新モデル リリース 直近24時間",
  "Claude Code OpenAI Gemini 新機能 アップデート",
  "AI活用 企業導入 事例 直近24時間",
];

// ---------------------------------------------------------------------------
// Grok API リクエスト
// ---------------------------------------------------------------------------

interface GrokPost {
  url?: string;
  author?: string;
  summary?: string;
  content?: string;
  title?: string;
}

function buildRequestBody(query: string) {
  return {
    model: MODEL,
    messages: [
      {
        role: "user",
        content: `以下のトピックに関する直近24時間のX投稿を検索し、重要なものを10件リストアップしてください。各投稿について、投稿のURL、投稿者名、内容の要約を含めてください。JSON形式で出力してください。トピック: ${query}`,
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "x_search",
          description: "Search X/Twitter posts",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        },
      },
    ],
  };
}

async function searchWithGrok(
  query: string,
  apiKey: string,
): Promise<RawArticle[]> {
  const res = await fetchWithTimeout(
    GROK_API_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildRequestBody(query)),
    },
    TIMEOUT_MS,
  );

  if (!res.ok) {
    console.log(`[Grok] HTTP ${res.status} for query: ${query}`);
    return [];
  }

  const data = await res.json();

  // レスポンスからテキスト部分を抽出
  const textContent = data?.choices?.[0]?.message?.content;
  if (!textContent || typeof textContent !== "string") return [];

  // JSON 配列を抽出してパース
  try {
    const jsonStr =
      textContent.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() ??
      textContent.match(/(\[[\s\S]*\])/)?.[1] ??
      textContent;

    const posts: GrokPost[] = JSON.parse(jsonStr);
    if (!Array.isArray(posts)) return [];

    return posts
      .filter((p) => p.url || p.summary || p.content)
      .map((p) => ({
        title: p.title ?? p.summary?.slice(0, 100) ?? "",
        url: p.url ?? "",
        source: "X (Grok)",
        content: p.summary ?? p.content ?? "",
        publishedAt: new Date().toISOString(),
        metadata: {
          author: p.author,
          searchQuery: query,
        },
      }));
  } catch {
    console.log(`[Grok] JSONパース失敗 for query: ${query}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

const grok: Collector = {
  name: "X (Grok)",

  async collect(): Promise<RawArticle[]> {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      console.log("[Grok] XAI_API_KEY が未設定 — スキップ");
      return [];
    }

    const articles: RawArticle[] = [];

    // 3つの検索クエリを順番に実行
    for (const query of SEARCH_QUERIES) {
      try {
        const results = await searchWithGrok(query, apiKey);
        articles.push(...results);
      } catch (error) {
        console.log(`[Grok] クエリ失敗 "${query}":`, error);
      }
    }

    // URL が空の記事を除外
    const valid = articles.filter((a) => a.url);
    console.log(`[Grok] ${valid.length}件取得`);
    return valid;
  },
};

export default grok;
