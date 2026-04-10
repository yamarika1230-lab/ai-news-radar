import Parser from "rss-parser";
import type { Collector, RawArticle } from "../types";

const PH_RSS_URL = "https://www.producthunt.com/feed";

const AI_KEYWORDS =
  /\b(ai|llm|gpt|claude|openai|anthropic|ml|machine.?learning|copilot|chatbot|generative|automation|agent|prompt|vector|rag)\b/i;

const parser = new Parser({
  timeout: 10_000,
});

const producthunt: Collector = {
  name: "ProductHunt",

  async collect(): Promise<RawArticle[]> {
    try {
      const feed = await parser.parseURL(PH_RSS_URL);
      const items = feed.items ?? [];

      const articles: RawArticle[] = items
        .filter((item) => {
          const text = `${item.title ?? ""} ${item.contentSnippet ?? ""}`;
          return AI_KEYWORDS.test(text);
        })
        .map((item) => ({
          title: item.title ?? "",
          url: item.link ?? "",
          source: "ProductHunt",
          content: item.contentSnippet?.slice(0, 500) ?? "",
          publishedAt:
            item.isoDate ?? item.pubDate ?? new Date().toISOString(),
          metadata: { guid: item.guid },
        }));

      console.log(`[ProductHunt] ${articles.length}件取得`);
      return articles;
    } catch (error) {
      console.log(`[ProductHunt] 取得失敗:`, error);
      return [];
    }
  },
};

export default producthunt;
