import type { Collector, RawArticle } from "../types";
import { fetchWithTimeout } from "./utils";

const SUBREDDITS = [
  "MachineLearning",
  "LocalLLaMA",
  "artificial",
  "ChatGPT",
  "ClaudeAI",
];

const USER_AGENT = "Mozilla/5.0 (compatible; AI-News-Radar/1.0)";
const TIMEOUT_MS = 10_000;

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
    stickied: boolean;
  };
}

const reddit: Collector = {
  name: "Reddit",

  async collect(): Promise<RawArticle[]> {
    const articles: RawArticle[] = [];

    for (const sub of SUBREDDITS) {
      try {
        const url = `https://old.reddit.com/r/${sub}/hot.json?limit=10&raw_json=1`;
        console.log(`[Reddit] リクエストURL: ${url}`);

        const res = await fetchWithTimeout(
          url,
          { headers: { "User-Agent": USER_AGENT } },
          TIMEOUT_MS,
        );

        console.log(`[Reddit] ${sub} response status: ${res.status}`);

        if (!res.ok) {
          const bodyText = await res.text().catch(() => "");
          console.log(
            `[Reddit] ${sub} エラー (${res.status}): ${bodyText.substring(0, 200)}`,
          );
          continue;
        }

        const json = await res.json();
        const children: RedditChild[] = json?.data?.children ?? [];

        const posts = children.filter(
          ({ data }) => !data.stickied && data.ups > 0,
        );

        console.log(
          `[Reddit] ${sub} 取得件数: ${posts.length} (全${children.length}件中)`,
        );

        if (posts.length === 0 && children.length === 0) {
          console.log(
            `[Reddit] ${sub} 0件 — body: ${JSON.stringify(json).substring(0, 200)}`,
          );
        }

        for (const { data } of posts) {
          const postUrl = data.is_self
            ? `https://www.reddit.com${data.permalink}`
            : data.url;

          articles.push({
            title: data.title,
            url: postUrl,
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
        console.log(`[Reddit] ${sub} 取得失敗:`, error);
        // 個別のサブレディット失敗は他に影響させない
      }
    }

    console.log(`[Reddit] 合計 ${articles.length}件取得`);
    return articles;
  },
};

export default reddit;
