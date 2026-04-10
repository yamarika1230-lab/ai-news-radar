import type { Collector, RawArticle, TrendingKeyword } from "../types";
import { fetchWithTimeout } from "./utils";

const SERPAPI_BASE = "https://serpapi.com/search.json";
const TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// (A) Google ニュース検索
// ---------------------------------------------------------------------------

interface SerpNewsResult {
  title?: string;
  link?: string;
  snippet?: string;
  source?: string;
  date?: string;
}

const serpapi: Collector = {
  name: "Google News",

  async collect(): Promise<RawArticle[]> {
    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) {
      console.log("[SerpApi] SERPAPI_KEY が未設定 — スキップ");
      return [];
    }

    try {
      const params = new URLSearchParams({
        engine: "google",
        q: "AI artificial intelligence LLM",
        tbm: "nws",
        num: "10",
        api_key: apiKey,
      });

      const res = await fetchWithTimeout(
        `${SERPAPI_BASE}?${params.toString()}`,
        {},
        TIMEOUT_MS,
      );

      if (!res.ok) {
        console.log(`[SerpApi] HTTP ${res.status}`);
        return [];
      }

      const data = await res.json();
      const newsResults: SerpNewsResult[] = data?.news_results ?? [];

      const articles: RawArticle[] = newsResults
        .filter((r) => r.link && r.title)
        .map((r) => ({
          title: r.title!,
          url: r.link!,
          source: "Google News",
          content: r.snippet ?? "",
          publishedAt: r.date
            ? new Date(r.date).toISOString()
            : new Date().toISOString(),
          metadata: {
            newsSource: r.source,
          },
        }));

      console.log(`[SerpApi] Google News: ${articles.length}件取得`);
      return articles;
    } catch (error) {
      console.log("[SerpApi] Google News 取得失敗:", error);
      return [];
    }
  },
};

// ---------------------------------------------------------------------------
// (B) Google Trends キーワード取得
// ---------------------------------------------------------------------------

interface SerpTrendPoint {
  value: number;
}

interface SerpTimelineData {
  values: SerpTrendPoint[];
}

interface SerpInterestOverTime {
  timeline_data?: SerpTimelineData[];
}

export async function fetchGoogleTrends(): Promise<TrendingKeyword[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    console.log("[SerpApi] SERPAPI_KEY が未設定 — トレンドスキップ");
    return [];
  }

  try {
    const params = new URLSearchParams({
      engine: "google_trends",
      q: "Claude Code,ChatGPT,Gemini,Copilot,AI Agent",
      api_key: apiKey,
    });

    const res = await fetchWithTimeout(
      `${SERPAPI_BASE}?${params.toString()}`,
      {},
      TIMEOUT_MS,
    );

    if (!res.ok) {
      console.log(`[SerpApi] Trends HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    const queries = ["Claude Code", "ChatGPT", "Gemini", "Copilot", "AI Agent"];
    const interestOverTime: SerpInterestOverTime | undefined =
      data?.interest_over_time;
    const timeline = interestOverTime?.timeline_data ?? [];

    // 各キーワードの直近2ポイントから変化率を算出
    const keywords: TrendingKeyword[] = queries.map((keyword, i) => {
      const values = timeline
        .map((t) => t.values?.[i]?.value ?? 0)
        .filter((v) => v > 0);

      let change = "new";
      let hot = false;

      if (values.length >= 2) {
        const current = values[values.length - 1];
        const previous = values[values.length - 2];
        if (previous > 0) {
          const pct = Math.round(((current - previous) / previous) * 100);
          change = pct >= 0 ? `+${pct}%` : `${pct}%`;
          hot = pct > 50 || current >= 80;
        }
      } else if (values.length === 1) {
        hot = values[0] >= 80;
        change = "+0%";
      }

      return { keyword, change, hot };
    });

    console.log(`[SerpApi] Google Trends: ${keywords.length}件取得`);
    return keywords;
  } catch (error) {
    console.log("[SerpApi] Google Trends 取得失敗:", error);
    return [];
  }
}

export default serpapi;
