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

      const query =
        "(AI OR LLM OR ChatGPT OR Claude OR Gemini OR OpenAI OR Anthropic) -is:retweet -is:reply min_faves:10";
      const url = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=10&tweet.fields=created_at,public_metrics,author_id,entities&expansions=author_id&user.fields=username,name`;

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

      if (!response.ok) {
        const errorText = await response.text();
        console.log("[X API] エラー:", errorText.substring(0, 300));
        return [];
      }

      const data = await response.json();
      console.log("[X API] レスポンスボディ:", JSON.stringify(data).substring(0, 500));

      const tweets: Tweet[] = data.data || [];
      const users: XUser[] = data.includes?.users || [];

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

export default xApi;
