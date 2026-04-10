import type { Collector, RawArticle } from "../types";

const TIMEOUT_MS = 15_000;
const QUERY_DELAY_MS = 500;
const MAX_RESULTS = 20;

interface Tweet {
  id: string;
  text: string;
  author_id: string;
  created_at?: string;
  public_metrics?: {
    like_count: number;
    reply_count: number;
    retweet_count: number;
    impression_count?: number;
  };
}

interface XUser {
  id: string;
  username: string;
  name: string;
}

// ---------------------------------------------------------------------------
// 複数の検索クエリ（それぞれ異なるAI関連トピック）
// ---------------------------------------------------------------------------

const QUERIES = [
  // AI活用事例・企業導入
  "AI活用 導入 事例 min_faves:100 -is:retweet -is:reply lang:ja",
  // Claude Code関連
  "Claude Code min_faves:50 -is:retweet -is:reply lang:ja",
  // ChatGPT・LLM活用
  "(ChatGPT OR GPT) 活用 min_faves:100 -is:retweet -is:reply lang:ja",
  // AIツール・効率化
  "(AI OR LLM) (効率化 OR 自動化 OR 生産性) min_faves:50 -is:retweet -is:reply lang:ja",
  // AI最新ニュース（英語圏の大きなニュース）
  "(OpenAI OR Anthropic OR Google AI) (launch OR release OR announce) min_faves:500 -is:retweet -is:reply lang:en",
];

// ---------------------------------------------------------------------------
// 1クエリ分の取得
// ---------------------------------------------------------------------------

async function fetchQuery(
  query: string,
  bearerToken: string,
): Promise<{ tweets: Tweet[]; users: XUser[] }> {
  const url = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=10&sort_order=relevancy&tweet.fields=created_at,public_metrics,author_id&expansions=author_id&user.fields=username,name`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseText = await response.text();

    if (!response.ok) {
      console.log(
        `[X API] クエリ失敗 (${response.status}): ${responseText.substring(0, 200)}`,
      );
      return { tweets: [], users: [] };
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.log("[X API] JSONパース失敗");
      return { tweets: [], users: [] };
    }

    if (data.errors) {
      console.log(
        "[X API] APIエラー:",
        JSON.stringify(data.errors).substring(0, 200),
      );
      return { tweets: [], users: [] };
    }

    const tweets = (data.data as Tweet[]) || [];
    const users =
      ((data.includes as Record<string, unknown>)?.users as XUser[]) || [];

    return { tweets, users };
  } catch (error) {
    clearTimeout(timeoutId);
    console.log(
      `[X API] fetch失敗: ${error instanceof Error ? error.message : error}`,
    );
    return { tweets: [], users: [] };
  }
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

const xApi: Collector = {
  name: "X",

  async collect(): Promise<RawArticle[]> {
    const bearerToken = process.env.X_BEARER_TOKEN;
    if (!bearerToken) {
      console.log("[X API] X_BEARER_TOKEN が未設定のためスキップ");
      return [];
    }

    console.log(`[X API] ${QUERIES.length}クエリで検索開始`);

    const allTweets: Tweet[] = [];
    const userMap = new Map<string, string>();
    const seenIds = new Set<string>();

    // 各クエリを順次実行（レートリミット対策で500ms間隔）
    for (let i = 0; i < QUERIES.length; i++) {
      const query = QUERIES[i];
      console.log(`[X API] クエリ ${i + 1}/${QUERIES.length}: ${query.substring(0, 60)}...`);

      try {
        const { tweets, users } = await fetchQuery(query, bearerToken);

        for (const user of users) {
          userMap.set(user.id, user.username);
        }

        // 重複除去して追加
        for (const tweet of tweets) {
          if (!seenIds.has(tweet.id)) {
            seenIds.add(tweet.id);
            allTweets.push(tweet);
          }
        }

        console.log(
          `[X API] クエリ ${i + 1}: ${tweets.length}件取得 (累計: ${allTweets.length}件)`,
        );
      } catch (error) {
        console.log(`[X API] クエリ ${i + 1} 失敗:`, error);
      }

      // レートリミット対策
      if (i < QUERIES.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, QUERY_DELAY_MS));
      }
    }

    console.log(`[X API] 全クエリ合計: ${allTweets.length}件（重複除去済み）`);

    // いいね数で降順ソートし上位N件を返す
    const sorted = allTweets.sort(
      (a, b) =>
        (b.public_metrics?.like_count || 0) -
        (a.public_metrics?.like_count || 0),
    );

    const top = sorted.slice(0, MAX_RESULTS);

    const articles: RawArticle[] = top.map((tweet) => {
      const username = userMap.get(tweet.author_id) || "unknown";
      return {
        title: tweet.text.substring(0, 100).replace(/\n/g, " "),
        url: `https://x.com/${username}/status/${tweet.id}`,
        source: "X",
        content: tweet.text,
        score: tweet.public_metrics?.like_count || 0,
        comments: tweet.public_metrics?.reply_count || 0,
        publishedAt: tweet.created_at || new Date().toISOString(),
        metadata: {
          username,
          likes: tweet.public_metrics?.like_count || 0,
          retweets: tweet.public_metrics?.retweet_count || 0,
          impressions: tweet.public_metrics?.impression_count || 0,
        },
      };
    });

    console.log(
      `[X API] 完了: ${articles.length}件（いいね数順上位${MAX_RESULTS}件）`,
    );
    return articles;
  },
};

export const collectXApi = xApi.collect.bind(xApi);
export default xApi;
