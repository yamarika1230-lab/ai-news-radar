import Parser from "rss-parser";
import type { Collector, RawArticle } from "../types";

const RSS_FEEDS = [
  { name: "Anthropic", url: "https://www.anthropic.com/rss.xml" },
  { name: "OpenAI", url: "https://openai.com/blog/rss.xml" },
  { name: "Google AI", url: "https://blog.google/technology/ai/rss/" },
  { name: "Meta AI", url: "https://ai.meta.com/blog/rss/" },
  { name: "Mistral", url: "https://mistral.ai/feed/" },
];

// 48時間のカットオフ
const CUTOFF_MS = 48 * 60 * 60 * 1000;

const parser = new Parser({
  timeout: 10_000,
});

const rssBlogs: Collector = {
  name: "RSS/Blogs",

  async collect(): Promise<RawArticle[]> {
    const articles: RawArticle[] = [];
    const cutoff = Date.now() - CUTOFF_MS;

    for (const feed of RSS_FEEDS) {
      try {
        const parsed = await parser.parseURL(feed.url);

        for (const item of parsed.items ?? []) {
          const pubDate = item.isoDate ?? item.pubDate;
          if (!pubDate) continue;

          // 48時間以内の記事のみ
          if (new Date(pubDate).getTime() < cutoff) continue;

          articles.push({
            title: item.title ?? "",
            url: item.link ?? "",
            source: feed.name,
            content: item.contentSnippet?.slice(0, 500) ?? "",
            publishedAt: pubDate,
            metadata: {
              feedName: feed.name,
              author: item.creator ?? item.author,
              guid: item.guid,
            },
          });
        }

        console.log(
          `[RSS/Blogs] ${feed.name}: ${parsed.items?.length ?? 0}件中フィルタ後取得`,
        );
      } catch (error) {
        console.log(`[RSS/Blogs] ${feed.name} 取得失敗:`, error);
      }
    }

    console.log(`[RSS/Blogs] 合計 ${articles.length}件取得`);
    return articles;
  },
};

export default rssBlogs;
