import type { Collector, RawArticle } from "../types";
import { fetchWithTimeout } from "./utils";

const SUBREDDITS = [
  "MachineLearning",
  "LocalLLaMA",
  "ClaudeAI",
  "ChatGPT",
  "artificial",
];

interface RedditChild {
  data: {
    title: string;
    url: string;
    ups: number;
    num_comments: number;
    selftext: string;
    author: string;
    created_utc: number;
    permalink: string;
    subreddit: string;
    is_self: boolean;
  };
}

const reddit: Collector = {
  name: "Reddit",

  async collect(): Promise<RawArticle[]> {
    const articles: RawArticle[] = [];

    for (const sub of SUBREDDITS) {
      try {
        const res = await fetchWithTimeout(
          `https://www.reddit.com/r/${sub}/hot.json?limit=25`,
          {
            headers: {
              "User-Agent": "AiNewsDashboard/1.0 (Node.js; server-side)",
            },
          },
        );

        if (!res.ok) {
          console.log(`[Reddit] r/${sub} HTTP ${res.status} — スキップ`);
          continue;
        }

        const json = await res.json();
        const children: RedditChild[] = json?.data?.children ?? [];

        for (const { data } of children) {
          // ピン留め投稿を除外
          if (data.ups < 1) continue;

          const url = data.is_self
            ? `https://www.reddit.com${data.permalink}`
            : data.url;

          articles.push({
            title: data.title,
            url,
            source: "Reddit",
            content: data.selftext.slice(0, 500),
            score: data.ups,
            comments: data.num_comments,
            publishedAt: new Date(data.created_utc * 1000).toISOString(),
            metadata: {
              subreddit: data.subreddit,
              author: data.author,
              permalink: data.permalink,
            },
          });
        }
      } catch (error) {
        console.log(`[Reddit] r/${sub} 取得失敗:`, error);
      }
    }

    console.log(`[Reddit] ${articles.length}件取得`);
    return articles;
  },
};

export default reddit;
