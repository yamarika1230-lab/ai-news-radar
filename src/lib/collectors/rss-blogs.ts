import Parser from "rss-parser";
import type { Collector, RawArticle } from "../types";

const AI_KEYWORDS =
  /\b(AI|人工知能|LLM|機械学習|深層学習|生成AI|ChatGPT|Claude|GPT|Gemini|Copilot)\b/i;

const RSS_FEEDS = [
  { name: "OpenAI", url: "https://openai.com/blog/rss.xml" },
  { name: "Google AI", url: "https://blog.google/technology/ai/rss/" },
  { name: "日経クロステック", url: "https://xtech.nikkei.com/rss/index.rdf", filter: true },
  { name: "ITmedia AI+", url: "https://rss.itmedia.co.jp/rss/2.0/aiplus.xml" },
  { name: "ZDNET Japan", url: "https://japan.zdnet.com/rss/index.rdf", filter: true },
];

// 36時間のカットオフ
const CUTOFF_MS = 36 * 60 * 60 * 1000;

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
        let count = 0;

        for (const item of parsed.items ?? []) {
          const pubDate = item.isoDate ?? item.pubDate;
          if (!pubDate) continue;

          // 48時間以内の記事のみ
          if (new Date(pubDate).getTime() < cutoff) continue;

          // フィルタ対象フィードはAI関連キーワードでフィルタリング
          if (
            "filter" in feed &&
            feed.filter &&
            !AI_KEYWORDS.test(
              `${item.title ?? ""} ${item.contentSnippet ?? ""}`,
            )
          ) {
            continue;
          }

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
          count++;
        }

        console.log(
          `[RSS/Blogs] ${feed.name}: ${count}件取得 (全${parsed.items?.length ?? 0}件中)`,
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
