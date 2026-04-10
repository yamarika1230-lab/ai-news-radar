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
        role: "system",
        content:
          "あなたはX/Twitterの投稿を検索して分析するアシスタントです。x_searchツールを使って検索を行い、結果をJSON配列で返してください。",
      },
      {
        role: "user",
        content: `以下のトピックに関する直近24時間のX投稿を検索し、重要なものを10件リストアップしてください。各投稿について、投稿のURL、投稿者名、内容の要約を含めてください。

出力形式（純粋なJSON配列のみ、コードブロック不要）:
[{"title":"投稿の概要","url":"https://x.com/...","author":"@username","summary":"内容の要約"}]

トピック: ${query}`,
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
    tool_choice: "auto",
  };
}

async function searchWithGrok(
  query: string,
  apiKey: string,
): Promise<RawArticle[]> {
  const requestBody = buildRequestBody(query);
  console.log(
    `[Grok] APIリクエスト送信: model=${requestBody.model}, query="${query}", tools=${requestBody.tools.length}個`,
  );

  const res = await fetchWithTimeout(
    GROK_API_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    },
    TIMEOUT_MS,
  );

  console.log(`[Grok] レスポンスステータス: ${res.status}`);

  // 生のレスポンスボディを取得（.json() ではなく .text() で中身を確認）
  const rawBody = await res.text();
  console.log(
    `[Grok] レスポンスボディ(先頭500文字): ${rawBody.substring(0, 500)}`,
  );

  if (!res.ok) {
    return [];
  }

  // テキストからJSONをパース
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawBody);
  } catch {
    console.log("[Grok] レスポンスボディのJSONパース失敗");
    return [];
  }

  // choices 構造を確認
  const choices = data?.choices as
    | { message?: { content?: string | null; tool_calls?: unknown[] }; finish_reason?: string }[]
    | undefined;

  if (!choices || choices.length === 0) {
    console.log("[Grok] choices が空またはなし");
    return [];
  }

  const message = choices[0]?.message;
  const finishReason = choices[0]?.finish_reason;
  console.log(
    `[Grok] finish_reason=${finishReason}, content type=${typeof message?.content}, content length=${typeof message?.content === "string" ? message.content.length : "N/A"}, tool_calls=${message?.tool_calls ? "あり" : "なし"}`,
  );

  // content を取得
  const textContent =
    typeof message?.content === "string" && message.content.trim()
      ? message.content
      : null;

  if (!textContent) {
    console.log(
      `[Grok] テキストcontent が空 — message keys: ${Object.keys(message ?? {}).join(", ")}`,
    );
    return [];
  }

  // JSON 配列を抽出してパース
  try {
    const jsonStr =
      textContent.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() ??
      textContent.match(/(\[[\s\S]*\])/)?.[1] ??
      textContent;

    const posts: GrokPost[] = JSON.parse(jsonStr);
    if (!Array.isArray(posts)) {
      console.log(`[Grok] パース結果が配列ではない: ${typeof posts}`);
      return [];
    }

    const articles = posts
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

    console.log(`[Grok] パース結果: ${articles.length}件`);
    return articles;
  } catch (error) {
    console.log(`[Grok] JSONパース失敗: ${error}`);
    console.log(`[Grok] パース対象テキスト: ${textContent.slice(0, 500)}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

const grok: Collector = {
  name: "X (Grok)",

  async collect(): Promise<RawArticle[]> {
    console.log(
      `[Grok] XAI_API_KEY設定: ${!!process.env.XAI_API_KEY}`,
    );
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      console.log("[Grok] XAI_API_KEY が未設定 — スキップ");
      return [];
    }

    const articles: RawArticle[] = [];

    for (const query of SEARCH_QUERIES) {
      try {
        const results = await searchWithGrok(query, apiKey);
        articles.push(...results);
      } catch (error) {
        console.log(`[Grok] クエリ失敗 "${query}":`, error);
      }
    }

    const valid = articles.filter((a) => a.url);
    console.log(
      `[Grok] 完了: 全${articles.length}件中、URL有効 ${valid.length}件`,
    );
    return valid;
  },
};

export default grok;
