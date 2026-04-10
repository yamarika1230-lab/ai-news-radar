import type { Collector, RawArticle } from "../types";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";
const MODEL = "grok-3-mini-fast";
const TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Grok API リクエスト（search_parameters によるビルトイン検索）
// ---------------------------------------------------------------------------

interface GrokPost {
  url?: string;
  author?: string;
  summary?: string;
  content?: string;
  title?: string;
}

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
      console.log(
        `[Grok] レスポンス先頭300文字: ${body.substring(0, 300)}`,
      );

      if (!res.ok) {
        console.log(`[Grok] HTTP ${res.status} — スキップ`);
        return [];
      }

      // JSON パース
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(body);
      } catch {
        console.log("[Grok] レスポンスのJSONパース失敗");
        return [];
      }

      // choices からテキストを抽出
      const choices = data?.choices as
        | { message?: { content?: string | null }; finish_reason?: string }[]
        | undefined;

      if (!choices || choices.length === 0) {
        console.log("[Grok] choices が空");
        return [];
      }

      const textContent = choices[0]?.message?.content;
      console.log(
        `[Grok] finish_reason=${choices[0]?.finish_reason}, content length=${typeof textContent === "string" ? textContent.length : "N/A"}`,
      );

      if (typeof textContent !== "string" || !textContent.trim()) {
        console.log("[Grok] テキスト content が空");
        return [];
      }

      // JSON 配列を抽出してパース
      const articles = parseGrokResponse(textContent);
      const valid = articles.filter((a) => a.url);
      console.log(`[Grok] 完了: ${valid.length}件`);
      return valid;
    } catch (error) {
      console.log("[Grok] 収集失敗:", error);
      return [];
    }
  },
};

// ---------------------------------------------------------------------------
// レスポンスパース
// ---------------------------------------------------------------------------

function parseGrokResponse(text: string): RawArticle[] {
  // JSON 配列の抽出を試行
  try {
    const jsonStr =
      text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() ??
      text.match(/(\[[\s\S]*\])/)?.[1] ??
      text;

    const posts: GrokPost[] = JSON.parse(jsonStr);
    if (!Array.isArray(posts)) {
      console.log(`[Grok] パース結果が配列ではない: ${typeof posts}`);
      return fallbackParse(text);
    }

    console.log(`[Grok] JSONパース成功: ${posts.length}件`);

    return posts
      .filter((p) => p.title || p.summary || p.content)
      .map((p) => ({
        title: p.title ?? p.summary?.slice(0, 100) ?? "",
        url: p.url ?? "",
        source: "X (Grok)",
        content: p.summary ?? p.content ?? "",
        publishedAt: new Date().toISOString(),
        metadata: { author: p.author },
      }));
  } catch (error) {
    console.log(`[Grok] JSONパース失敗: ${error}`);
    return fallbackParse(text);
  }
}

/**
 * JSON パースに失敗した場合のフォールバック:
 * テキストからURL行を抽出して記事を構成する
 */
function fallbackParse(text: string): RawArticle[] {
  console.log("[Grok] フォールバックパースを試行");

  const urlRegex = /https?:\/\/(?:x\.com|twitter\.com)\/\S+/g;
  const urls = text.match(urlRegex);
  if (!urls || urls.length === 0) {
    console.log("[Grok] フォールバック: URLが見つからず");
    return [];
  }

  // テキストを行単位で分割し、各URLの前後のテキストを要約として取得
  const lines = text.split("\n").filter((l) => l.trim());
  const articles: RawArticle[] = [];

  for (const url of urls) {
    const lineIdx = lines.findIndex((l) => l.includes(url));
    // URL を含む行の前の行をタイトル候補に
    const titleLine =
      lineIdx > 0
        ? lines[lineIdx - 1].replace(/^[\d\.\-\*]+\s*/, "").trim()
        : "";
    const title = titleLine || url;

    articles.push({
      title,
      url,
      source: "X (Grok)",
      content: "",
      publishedAt: new Date().toISOString(),
    });
  }

  console.log(`[Grok] フォールバック結果: ${articles.length}件`);
  return articles;
}

export default grok;
