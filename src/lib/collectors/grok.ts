import type { Collector, RawArticle } from "../types";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";
const MODEL = "grok-3-mini-fast";
const TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// JSON配列の安全な抽出
// ---------------------------------------------------------------------------

interface GrokPost {
  url?: string;
  author?: string;
  summary?: string;
  content?: string;
  title?: string;
}

function extractJsonArray(text: string): GrokPost[] {
  // 直接パース
  try {
    const direct = JSON.parse(text);
    if (Array.isArray(direct)) return direct;
  } catch { /* fall through */ }

  // ```json ... ``` ブロック
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fall through */ }
  }

  // [...] を直接探す
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fall through */ }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

const grok: Collector = {
  name: "X (Grok)",

  async collect(): Promise<RawArticle[]> {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      console.log("[Grok] XAI_API_KEY が未設定のためスキップ");
      return [];
    }
    console.log(`[Grok] APIキー先頭5文字: ${apiKey.substring(0, 5)}`);

    try {
      console.log("[Grok] リクエスト送信");

      const res = await fetch(GROK_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          search_parameters: {
            mode: "auto",
            return_citations: true,
          },
          messages: [
            {
              role: "user",
              content:
                '直近24時間のAI・LLM関連の重要ニュースをX上の投稿から10件リストアップしてください。各項目について、投稿URL、内容の要約を含め、JSON配列で出力してください。形式: [{"title": "...", "url": "...", "summary": "..."}]',
            },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      console.log(`[Grok] レスポンスステータス: ${res.status}`);

      const body = await res.text();
      console.log(`[Grok] レスポンス先頭300文字: ${body.substring(0, 300)}`);

      if (!res.ok) return [];

      // API レスポンスの JSON パース
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(body);
      } catch {
        console.log("[Grok] レスポンスのJSONパース失敗");
        return [];
      }

      // choices[0].message.content からテキスト取得
      const choices = data?.choices as
        | { message?: { content?: string | null }; finish_reason?: string }[]
        | undefined;

      if (!choices || choices.length === 0) {
        console.log("[Grok] choices が空");
        return [];
      }

      const content = choices[0]?.message?.content;
      console.log(
        `[Grok] content text length: ${typeof content === "string" ? content.length : "N/A"}`,
      );

      if (typeof content !== "string" || !content.trim()) {
        console.log("[Grok] テキスト content が空");
        return [];
      }

      // JSON 配列を抽出
      const posts = extractJsonArray(content);
      console.log(`[Grok] extractJsonArray結果: ${posts.length}件`);

      if (posts.length > 0) {
        const articles = posts
          .filter((p) => p.title || p.summary || p.content)
          .slice(0, 10)
          .map((p) => ({
            title: p.title ?? p.summary?.slice(0, 100) ?? "",
            url: p.url ?? "",
            source: "X (Grok)",
            content: p.summary ?? p.content ?? "",
            publishedAt: new Date().toISOString(),
            metadata: { author: p.author },
          }));

        const valid = articles.filter((a) => a.url);
        console.log(`[Grok] JSON抽出成功: ${valid.length}件`);
        return valid;
      }

      // JSON失敗 → URL抽出フォールバック
      const urlRegex = /https?:\/\/(?:x\.com|twitter\.com)\/\S+/g;
      const urls = content.match(urlRegex);

      if (urls && urls.length > 0) {
        const lines = content.split("\n").filter((l) => l.trim());
        const articles: RawArticle[] = urls.slice(0, 10).map((url) => {
          const lineIdx = lines.findIndex((l) => l.includes(url));
          const titleLine =
            lineIdx > 0
              ? lines[lineIdx - 1].replace(/^[\d.\-*]+\s*/, "").trim()
              : "";
          return {
            title: titleLine || url,
            url,
            source: "X (Grok)",
            content: "",
            publishedAt: new Date().toISOString(),
          };
        });
        console.log(`[Grok] URL抽出フォールバック: ${articles.length}件`);
        return articles;
      }

      // 最終フォールバック: テキスト全体を1件として返す
      console.log("[Grok] テキスト全体を1件として返却");
      return [
        {
          title: "X上のAI最新動向まとめ",
          url: "https://x.com",
          source: "X (Grok)",
          content: content.slice(0, 500),
          publishedAt: new Date().toISOString(),
        },
      ];
    } catch (error) {
      console.log("[Grok] 収集失敗:", error);
      return [];
    }
  },
};

export default grok;
