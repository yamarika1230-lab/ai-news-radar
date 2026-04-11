import Parser from "rss-parser";
import type { Collector, RawArticle } from "../types";
import { isWithinHours } from "../utils";

const FEED_URLS = [
  "https://note.com/hashtag/AI?rss",
  "https://note.com/hashtag/ChatGPT?rss",
  "https://note.com/hashtag/Claude?rss",
  "https://note.com/hashtag/生成AI?rss",
  "https://note.com/hashtag/LLM?rss",
];

const parser = new Parser({
  timeout: 10_000,
  headers: { "User-Agent": "AI-News-Radar/1.0" },
});

const noteCollector: Collector = {
  name: "note",

  async collect(): Promise<RawArticle[]> {
    console.log("[note] 記事取得開始");
    const allArticles: RawArticle[] = [];

    for (const feedUrl of FEED_URLS) {
      try {
        const feed = await parser.parseURL(feedUrl);
        for (const item of feed.items ?? []) {
          const pubDate = item.isoDate ?? item.pubDate;
          if (!pubDate || !isWithinHours(pubDate, 36)) continue;

          allArticles.push({
            title: item.title ?? "",
            url: item.link ?? "",
            source: "note",
            content: (item.contentSnippet ?? item.content ?? "").substring(
              0,
              500,
            ),
            publishedAt: pubDate,
          });
        }
      } catch (e) {
        console.log(
          `[note] フィード失敗: ${feedUrl}`,
          (e as Error).message,
        );
      }
    }

    // URL 重複除去
    const seen = new Set<string>();
    const unique = allArticles.filter((a) => {
      if (seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });

    console.log(`[note] 合計 ${unique.length}件取得`);
    return unique.slice(0, 10);
  },
};

export default noteCollector;
