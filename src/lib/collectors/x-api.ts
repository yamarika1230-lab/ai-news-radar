import type { Collector, RawArticle } from "../types";

const TIMEOUT_MS = 15_000;

interface Tweet {
  id: string;
  text: string;
  author_id: string;
  created_at?: string;
  public_metrics?: {
    like_count: number;
    reply_count: number;
    retweet_count: number;
  };
}

interface XUser {
  id: string;
  username: string;
  name: string;
}

const xApi: Collector = {
  name: "X",

  async collect(): Promise<RawArticle[]> {
    const bearerToken = process.env.X_BEARER_TOKEN;
    if (!bearerToken) {
      console.log("[X API] X_BEARER_TOKEN が未設定のためスキップ");
      return [];
    }

    try {
      console.log("[X API] ツイート検索開始");

      const query = "AI lang:ja -is:retweet";
      const url = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=10&tweet.fields=created_at,public_metrics,author_id&expansions=author_id&user.fields=username,name`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log("[X API] レスポンスステータス:", response.status);

      const responseText = await response.text();
      console.log("[X API] レスポンス全文:", responseText.substring(0, 800));

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(responseText);
      } catch {
        console.log("[X API] JSONパース失敗");
        return [];
      }

      if (data.errors) {
        console.log("[X API] APIエラー:", JSON.stringify(data.errors).substring(0, 300));
        return [];
      }

      if (!response.ok) {
        return [];
      }

      const tweets: Tweet[] = (data.data as Tweet[]) || [];
      const users: XUser[] = ((data.includes as Record<string, unknown>)?.users as XUser[]) || [];

      console.log("[X API] 取得ツイート数:", tweets.length);

      const userMap = new Map<string, string>();
      for (const user of users) {
        userMap.set(user.id, user.username);
      }

      return tweets.map((tweet) => {
        const username = userMap.get(tweet.author_id) || "unknown";
        const tweetUrl = `https://x.com/${username}/status/${tweet.id}`;

        return {
          title: tweet.text.substring(0, 100).replace(/\n/g, " "),
          url: tweetUrl,
          source: "X",
          content: tweet.text,
          score: tweet.public_metrics?.like_count || 0,
          comments: tweet.public_metrics?.reply_count || 0,
          publishedAt: tweet.created_at || new Date().toISOString(),
          metadata: {
            username,
            likes: tweet.public_metrics?.like_count || 0,
            retweets: tweet.public_metrics?.retweet_count || 0,
          },
        };
      });
    } catch (error) {
      console.log(
        "[X API] エラー:",
        error instanceof Error ? error.message : error,
      );
      return [];
    }
  },
};

export const collectXApi = xApi.collect.bind(xApi);
export default xApi;
