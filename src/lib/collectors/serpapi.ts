import type { Collector, RawArticle, TrendingKeyword } from "../types";
import { fetchWithTimeout } from "./utils";

const SERPAPI_BASE = "https://serpapi.com/search.json";
const TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// (A) Google ニュース検索
// ---------------------------------------------------------------------------

interface SerpNewsResult {
  title?: string;
  link?: string;
  snippet?: string;
  source?: string | { name?: string };
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

    // まず google_news エンジンを試し、ダメなら google+tbm=nws にフォールバック
    const articles = await collectWithGoogleNews(apiKey);
    if (articles.length > 0) return articles;

    console.log("[SerpApi] google_news 0件 — tbm=nws にフォールバック");
    return await collectWithGoogleTbm(apiKey);
  },
};

// ---------------------------------------------------------------------------
// google_news エンジン
// ---------------------------------------------------------------------------

async function collectWithGoogleNews(
  apiKey: string,
): Promise<RawArticle[]> {
  try {
    const params = new URLSearchParams({
      engine: "google_news",
      q: "AI artificial intelligence LLM",
      gl: "us",
      hl: "en",
      api_key: apiKey,
    });

    const res = await fetchWithTimeout(
      `${SERPAPI_BASE}?${params.toString()}`,
      {},
      TIMEOUT_MS,
    );
    console.log(`[SerpApi] google_news ステータス: ${res.status}`);

    if (!res.ok) return [];

    const data = await res.json();
    const newsResults = ((data as Record<string, unknown>).news_results ?? []) as SerpNewsResult[];
    console.log(`[SerpApi] news_results: ${newsResults.length}件`);

    return mapToArticles(newsResults);
  } catch (error) {
    console.log("[SerpApi] google_news 失敗:", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// フォールバック: google エンジン + tbm=nws
// ---------------------------------------------------------------------------

async function collectWithGoogleTbm(
  apiKey: string,
): Promise<RawArticle[]> {
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
    console.log(`[SerpApi] tbm=nws ステータス: ${res.status}`);

    if (!res.ok) return [];

    const data = await res.json();
    const d = data as Record<string, unknown>;
    const newsResults = (d.news_results ?? []) as SerpNewsResult[];
    const organicResults = (d.organic_results ?? []) as SerpNewsResult[];

    console.log(
      `[SerpApi] tbm=nws news=${newsResults.length}, organic=${organicResults.length}`,
    );

    const results = newsResults.length > 0 ? newsResults : organicResults;
    return mapToArticles(results);
  } catch (error) {
    console.log("[SerpApi] tbm=nws 失敗:", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// SerpApi レスポンスを RawArticle[] に変換
// ---------------------------------------------------------------------------

function mapToArticles(results: SerpNewsResult[]): RawArticle[] {
  return results
    .filter((r) => r.link && r.title)
    .map((r) => ({
      title: r.title!,
      url: r.link!,
      source: "Google News",
      content: r.snippet ?? "",
      publishedAt: parseRelativeDate(r.date),
      metadata: {
        newsSource:
          typeof r.source === "object" ? r.source?.name : r.source,
      },
    }));
}

function parseRelativeDate(dateStr?: string): string {
  if (!dateStr) return new Date().toISOString();

  const relativeMatch = dateStr.match(
    /(\d+)\s+(minute|hour|day|week|month)s?\s+ago/i,
  );
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();
    const ms: Record<string, number> = {
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 604_800_000,
      month: 2_592_000_000,
    };
    return new Date(Date.now() - amount * (ms[unit] ?? 0)).toISOString();
  }

  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return new Date().toISOString();
}

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
    console.log(`[SerpApi] Trends ステータス: ${res.status}`);

    if (!res.ok) return [];

    const data = await res.json();
    const queries = [
      "Claude Code",
      "ChatGPT",
      "Gemini",
      "Copilot",
      "AI Agent",
    ];
    const interestOverTime = (data as Record<string, unknown>)
      .interest_over_time as SerpInterestOverTime | undefined;
    const timeline = interestOverTime?.timeline_data ?? [];

    if (timeline.length === 0) {
      console.log("[SerpApi] Trends データが空");
      return [];
    }

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
          const pct = Math.round(
            ((current - previous) / previous) * 100,
          );
          change = pct >= 0 ? `+${pct}%` : `${pct}%`;
          hot = pct > 50 || current >= 80;
        }
      } else if (values.length === 1) {
        hot = values[0] >= 80;
        change = "+0%";
      }

      return { keyword, change, hot };
    });

    console.log(`[SerpApi] Trends: ${keywords.length}件`);
    return keywords;
  } catch (error) {
    console.log("[SerpApi] Trends 失敗:", error);
    return [];
  }
}

export default serpapi;
