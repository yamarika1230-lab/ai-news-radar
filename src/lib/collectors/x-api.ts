import type { Collector, RawArticle } from "../types";
import { isWithinHours } from "../utils";

const TIMEOUT_MS = 15_000;
const QUERY_DELAY_MS = 200;
const MAX_RESULTS = 25;

interface Tweet {
  id: string;
  text: string;
  author_id: string;
  created_at?: string;
  entities?: { urls?: { expanded_url?: string }[] };
  public_metrics?: {
    like_count: number;
    reply_count: number;
    retweet_count: number;
    quote_count?: number;
    impression_count?: number;
  };
}

interface XUser {
  id: string;
  username: string;
  name: string;
}

// ---------------------------------------------------------------------------
// 目的別検索クエリ
// ---------------------------------------------------------------------------

const QUERIES = [
  // 1: AI企業の最新発表・ニュース（日本語）
  '(Anthropic OR OpenAI OR Google OR Meta OR Microsoft) (発表 OR リリース OR 新機能 OR アップデート) -is:retweet -is:reply lang:ja',
  // 2: Claude Code / Claude関連の実践活用
  '(Claude Code OR "Claude スキル" OR CLAUDE.md) -is:retweet -is:reply lang:ja',
  // 3: LLM新モデル・ベンチマーク
  '(新モデル OR ベンチマーク OR GPT OR Gemini OR Claude OR Llama) (すごい OR やばい OR 発表 OR リリース) -is:retweet -is:reply lang:ja',
  // 4: AI活用の実践事例・Tips
  '(AI OR LLM OR ChatGPT OR Claude) (活用 OR 使ってみた OR 作ってみた OR 試してみた OR 便利 OR 効率化) -is:retweet -is:reply lang:ja',
  // 5: AIビジネス・企業動向
  '(AI OR 人工知能) (導入 OR 提携 OR 買収 OR 資金調達 OR 上場 OR 株価) -is:retweet -is:reply lang:ja',
  // 6: AIエンジニアリング実践
  '(MCP OR AIエージェント OR "AI Agent" OR プロンプトエンジニアリング) -is:retweet -is:reply lang:ja',
  // 7: 海外AI業界の大きなニュース（英語）
  '(OpenAI OR Anthropic OR "Google DeepMind") (announced OR launched OR released OR "new model") -is:retweet -is:reply lang:en',
  // 8: AI企業の株・ビジネスニュース（英語）
  '(Palantir OR NVIDIA OR "AI stocks" OR "AI startup") (funding OR IPO OR partnership OR revenue) -is:retweet -is:reply lang:en',
];

// ---------------------------------------------------------------------------
// エンゲージメントスコア
// ---------------------------------------------------------------------------

function engagementScore(t: Tweet): number {
  const m = t.public_metrics;
  return (
    (m?.like_count || 0) +
    (m?.retweet_count || 0) * 3 +
    (m?.quote_count || 0) * 5
  );
}

// ---------------------------------------------------------------------------
// 1クエリ分の取得
// ---------------------------------------------------------------------------

async function fetchQuery(
  query: string,
  bearerToken: string,
): Promise<{ tweets: Tweet[]; users: XUser[]; rateLimited: boolean }> {
  const url = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=15&sort_order=relevancy&tweet.fields=created_at,public_metrics,author_id,entities&expansions=author_id&user.fields=username,name`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // レートリミット検出
    if (response.status === 429) {
      console.log("[X API] レートリミット（429）— 検索を打ち切り");
      return { tweets: [], users: [], rateLimited: true };
    }

    const responseText = await response.text();

    if (!response.ok) {
      console.log(
        `[X API] クエリ失敗 (${response.status}): ${responseText.substring(0, 200)}`,
      );
      return { tweets: [], users: [], rateLimited: false };
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.log("[X API] JSONパース失敗");
      return { tweets: [], users: [], rateLimited: false };
    }

    if (data.errors) {
      console.log(
        "[X API] APIエラー:",
        JSON.stringify(data.errors).substring(0, 200),
      );
      return { tweets: [], users: [], rateLimited: false };
    }

    const tweets = (data.data as Tweet[]) || [];
    const users =
      ((data.includes as Record<string, unknown>)?.users as XUser[]) || [];

    return { tweets, users, rateLimited: false };
  } catch (error) {
    clearTimeout(timeoutId);
    console.log(
      `[X API] fetch失敗: ${error instanceof Error ? error.message : error}`,
    );
    return { tweets: [], users: [], rateLimited: false };
  }
}

// ---------------------------------------------------------------------------
// URLベースの重複チェック用ヘルパー
// ---------------------------------------------------------------------------

function extractUrls(tweet: Tweet): string[] {
  return (
    tweet.entities?.urls?.map((u) => u.expanded_url || "").filter(Boolean) ||
    []
  );
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
    const seenUrls = new Set<string>();

    for (let i = 0; i < QUERIES.length; i++) {
      const query = QUERIES[i];
      console.log(
        `[X API] クエリ ${i + 1}/${QUERIES.length}: ${query.substring(0, 60)}...`,
      );

      try {
        const { tweets, users, rateLimited } = await fetchQuery(
          query,
          bearerToken,
        );

        if (rateLimited) {
          console.log(
            `[X API] レートリミット到達 — ${allTweets.length}件で打ち切り`,
          );
          break;
        }

        for (const user of users) {
          userMap.set(user.id, user.username);
        }

        // tweet ID + URL ベースで重複除去
        for (const tweet of tweets) {
          if (seenIds.has(tweet.id)) continue;

          const tweetUrls = extractUrls(tweet);
          const urlDup = tweetUrls.some((u) => seenUrls.has(u));
          if (urlDup) continue;

          seenIds.add(tweet.id);
          tweetUrls.forEach((u) => seenUrls.add(u));
          allTweets.push(tweet);
        }

        console.log(
          `[X API] クエリ ${i + 1}: ${tweets.length}件取得 (累計: ${allTweets.length}件)`,
        );
      } catch (error) {
        console.log(`[X API] クエリ ${i + 1} 失敗:`, error);
      }

      if (i < QUERIES.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, QUERY_DELAY_MS));
      }
    }

    // 36時間以内のツイートのみ
    const recentTweets = allTweets.filter(
      (t) => !t.created_at || isWithinHours(t.created_at, 36),
    );
    console.log(
      `[X API] 全クエリ合計: ${allTweets.length}件 → 36h内: ${recentTweets.length}件`,
    );

    // エンゲージメントスコア順ソート → 上位N件
    const sorted = [...recentTweets]
      .sort((a, b) => engagementScore(b) - engagementScore(a))
      .slice(0, MAX_RESULTS);

    console.log(
      `[X API] 上位${sorted.length}件を選出（エンゲージメントスコア順）`,
    );

    const articles: RawArticle[] = sorted.map((tweet) => {
      const username = userMap.get(tweet.author_id) || "unknown";
      // タイトル: URLを除去し、改行をスペースに
      const title = tweet.text
        .substring(0, 140)
        .replace(/\n/g, " ")
        .replace(/https?:\/\/\S+/g, "")
        .trim();

      return {
        title: title || "X上のAI関連投稿",
        url: `https://x.com/${username}/status/${tweet.id}`,
        source: "X",
        content: tweet.text,
        score: engagementScore(tweet),
        comments: tweet.public_metrics?.reply_count || 0,
        publishedAt: tweet.created_at || new Date().toISOString(),
        metadata: {
          username,
          likes: tweet.public_metrics?.like_count || 0,
          retweets: tweet.public_metrics?.retweet_count || 0,
          quotes: tweet.public_metrics?.quote_count || 0,
        },
      };
    });

    console.log(`[X API] 完了: ${articles.length}件`);
    return articles;
  },
};

export const collectXApi = xApi.collect.bind(xApi);
export default xApi;
