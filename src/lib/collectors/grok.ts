import type { Collector, RawArticle } from "../types";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";
const MODEL = "grok-3-mini-fast";
const TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// レスポンスパース
// ---------------------------------------------------------------------------

interface GrokItem {
  [key: string]: unknown;
}

function parseGrokResponse(content: string): RawArticle[] {
  // 方法1: 直接パース
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      console.log(`[Grok] 直接JSONパース成功: ${parsed.length}件`);
      return mapItems(parsed);
    }
  } catch { /* fall through */ }

  // 方法2: ```json ... ``` ブロック
  const codeBlock = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try {
      const parsed = JSON.parse(codeBlock[1].trim());
      if (Array.isArray(parsed)) {
        console.log(`[Grok] コードブロックパース成功: ${parsed.length}件`);
        return mapItems(parsed);
      }
    } catch { /* fall through */ }
  }

  // 方法3: [...] を探す
  const arrayMatch = content.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        console.log(`[Grok] 配列抽出パース成功: ${parsed.length}件`);
        return mapItems(parsed);
      }
    } catch { /* fall through */ }
  }

  // 方法4: テキストからURL抽出
  const urlPattern = /https?:\/\/[^\s)]+/g;
  const urls = content.match(urlPattern);

  if (urls && urls.length > 0) {
    console.log(`[Grok] URL抽出: ${urls.length}件`);
    const lines = content.split("\n").filter((l) => l.trim());
    return urls.slice(0, 10).map((url) => {
      const lineIdx = lines.findIndex((l) => l.includes(url));
      const titleLine =
        lineIdx > 0
          ? lines[lineIdx - 1].replace(/^[\d.\-*]+\s*/, "").trim()
          : "";
      return {
        title: titleLine || "X上のAI関連投稿",
        url,
        source: "X (Grok)",
        content: "",
        publishedAt: new Date().toISOString(),
      };
    });
  }

  // 方法5: テキスト全体を1件として返す
  if (content.length > 50) {
    console.log("[Grok] テキスト全体を1件として返却");
    return [
      {
        title: "X上のAI最新動向まとめ（Grok分析）",
        url: "https://x.com",
        source: "X (Grok)",
        content: content.substring(0, 1000),
        publishedAt: new Date().toISOString(),
      },
    ];
  }

  return [];
}

/** 柔軟なフィールド名対応でRawArticle[]に変換 */
function mapItems(items: GrokItem[]): RawArticle[] {
  return items
    .map((item) => {
      const title =
        str(item.title) || str(item.headline) || str(item.name) || "";
      const url =
        str(item.url) || str(item.link) || str(item.post_url) || "";
      const summary =
        str(item.summary) ||
        str(item.description) ||
        str(item.content) ||
        str(item.text) ||
        "";
      return {
        title: title || summary.substring(0, 100) || "X上のAI関連投稿",
        url: url || "https://x.com",
        source: "X (Grok)",
        content: summary,
        publishedAt: new Date().toISOString(),
        metadata: { author: str(item.author) || str(item.user) },
      };
    })
    .filter((a) => a.title !== "X上のAI関連投稿" || a.content.length > 0);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
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
      if (!res.ok) return [];

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content || "";
      console.log(`[Grok] content length: ${content.length}`);
      console.log(`[Grok] content preview: ${content.substring(0, 200)}`);

      if (!content || content.length === 0) {
        console.log("[Grok] content が空");
        return [];
      }

      const articles = parseGrokResponse(content).slice(0, 10);
      console.log(`[Grok] 最終結果: ${articles.length}件`);
      return articles;
    } catch (error) {
      console.log("[Grok] 収集失敗:", error);
      return [];
    }
  },
};

export default grok;
