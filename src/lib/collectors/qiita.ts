import type { Collector, RawArticle } from "../types";
import { isWithinHours } from "../utils";

const qiita: Collector = {
  name: "Qiita",

  async collect(): Promise<RawArticle[]> {
    try {
      console.log("[Qiita] 記事取得開始");

      const tags = ["AI", "LLM", "ChatGPT", "Claude", "OpenAI", "機械学習", "生成AI", "AIエージェント"];
      const query = tags.join("+OR+");
      const url = `https://qiita.com/api/v2/items?query=${query}&per_page=10&page=1`;

      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });

      console.log("[Qiita] レスポンスステータス:", response.status);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.log("[Qiita] エラー:", errorText.substring(0, 200));
        return [];
      }

      const items: Record<string, unknown>[] = await response.json();
      console.log("[Qiita] 取得件数:", items.length);

      const articles: RawArticle[] = items
        .filter((a) => {
          const createdAt = String(a.created_at ?? "");
          return isWithinHours(createdAt, 36);
        })
        .map((a) => ({
          title: String(a.title ?? ""),
          url: String(a.url ?? ""),
          source: "Qiita",
          content: String(a.body ?? "").substring(0, 500),
          score: Number(a.likes_count ?? 0),
          publishedAt: String(a.created_at ?? new Date().toISOString()),
          metadata: {
            author: String(
              (a.user as Record<string, unknown>)?.id ?? "",
            ),
            likes: Number(a.likes_count ?? 0),
            tags: ((a.tags ?? []) as Record<string, unknown>[])
              .map((t) => String(t.name ?? ""))
              .join(", "),
          },
        }));

      console.log(`[Qiita] 36h以内: ${articles.length}件`);
      return articles;
    } catch (error) {
      console.log(
        "[Qiita] エラー:",
        error instanceof Error ? error.message : error,
      );
      return [];
    }
  },
};

export default qiita;
