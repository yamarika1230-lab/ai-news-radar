import type { Collector, RawArticle, TrendingKeyword } from "../types";
import { fetchWithTimeout } from "./utils";

const SERPAPI_BASE = "https://serpapi.com/search.json";
const TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// (A) Google ニュース検索 — 複数クエリ
// ---------------------------------------------------------------------------

interface SerpNewsResult {
  title?: string;
  link?: string;
  snippet?: string;
  source?: string | { name?: string };
  date?: string;
}

const NEWS_QUERIES = [
  { q: "AI artificial intelligence LLM", hl: "en", gl: "us" },
  { q: "企業 AI活用 導入", hl: "ja", gl: "jp" },
  { q: "AI 資金調達 企業価値", hl: "ja", gl: "jp" },
  { q: "AI insurance fintech healthcare", hl: "en", gl: "us" },
  { q: "生成AI 業務効率化 DX", hl: "ja", gl: "jp" },
];

const serpapi: Collector = {
  name: "Google News",

  async collect(): Promise<RawArticle[]> {
    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) {
      console.log("[SerpApi] SERPAPI_KEY が未設定 — スキップ");
      return [];
    }

    const allArticles: RawArticle[] = [];
    const seenUrls = new Set<string>();

    for (const nq of NEWS_QUERIES) {
      try {
        const params = new URLSearchParams({
          engine: "google",
          q: nq.q,
          tbm: "nws",
          num: "5",
          tbs: "qdr:d2",
          hl: nq.hl,
          gl: nq.gl,
          api_key: apiKey,
        });

        const res = await fetchWithTimeout(
          `${SERPAPI_BASE}?${params.toString()}`,
          {},
          TIMEOUT_MS,
        );

        if (!res.ok) continue;

        const data = await res.json();
        const d = data as Record<string, unknown>;
        const results = ((d.news_results ?? d.organic_results ?? []) as SerpNewsResult[]);

        for (const r of results) {
          if (!r.link || !r.title) continue;
          const norm = r.link.split("?")[0].toLowerCase();
          if (seenUrls.has(norm)) continue;
          seenUrls.add(norm);

          allArticles.push({
            title: r.title,
            url: r.link,
            source: "Google News",
            content: r.snippet ?? "",
            publishedAt: parseRelativeDate(r.date),
            metadata: {
              newsSource: typeof r.source === "object" ? r.source?.name : r.source,
              query: nq.q,
            },
          });
        }

        console.log(`[SerpApi] "${nq.q}": ${results.length}件`);
      } catch (error) {
        console.log(`[SerpApi] "${nq.q}" 失敗:`, error);
      }
    }

    const limited = allArticles.slice(0, 10);
    console.log(`[SerpApi] Google News合計: ${limited.length}件 (全${allArticles.length}件)`);
    return limited;
  },
};

// ---------------------------------------------------------------------------
// 相対日付パース
// ---------------------------------------------------------------------------

function parseRelativeDate(dateStr?: string): string {
  if (!dateStr) return new Date().toISOString();
  const m = dateStr.match(/(\d+)\s+(minute|hour|day|week|month)s?\s+ago/i);
  if (m) {
    const ms: Record<string, number> = {
      minute: 60_000, hour: 3_600_000, day: 86_400_000,
      week: 604_800_000, month: 2_592_000_000,
    };
    return new Date(Date.now() - parseInt(m[1]) * (ms[m[2].toLowerCase()] ?? 0)).toISOString();
  }
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

// ---------------------------------------------------------------------------
// (B) Google Trends 急上昇ワード
// ---------------------------------------------------------------------------

const AI_TREND_KEYWORDS = [
  // A. 技術の移行トレンド
  "AI", "人工知能", "ChatGPT", "GPT", "Claude", "Gemini", "LLM",
  "生成AI", "OpenAI", "Anthropic", "Google AI", "Copilot", "Grok",
  "Llama", "Mistral", "NVIDIA", "GPU", "半導体",
  "AIエージェント", "AI Agent", "マルチエージェント", "自律型AI",
  "エージェント", "Agentic", "MCP", "ツール連携",
  "プロンプト", "プロンプトエンジニアリング", "Claude Code",
  "Cursor", "Devin", "vibe coding", "AI駆動開発",
  // B. 企業の実課題（B2B）
  "AI ガバナンス", "AIガバナンス", "AI セキュリティ", "AIセキュリティ",
  "AI規制", "AI法", "責任あるAI", "AI倫理",
  "AI導入", "AI活用", "業務効率化", "DX", "デジタルトランスフォーメーション",
  "AI 自動化", "RPA AI", "業務改革",
  "RAG", "ベクトルDB", "ナレッジマネジメント AI", "データ基盤",
  // C. 検索の未来・マーケティング
  "AEO", "GEO", "AI検索", "AIオーバービュー", "AI Overview",
  "SearchGPT", "Perplexity", "AI SEO",
  "LLM 比較", "AI 比較", "LLM 選定",
  "AI 投資", "AI 株", "AI スタートアップ", "AI 資金調達",
  "Palantir", "データセンター",
  // D. AGI・汎用人工知能
  "AGI", "汎用人工知能", "ASI", "超知能", "人工超知能",
  "スーパーインテリジェンス", "Superintelligence",
  // E. FDE
  "FDE", "Forward Deployed Engineer", "フォワードデプロイドエンジニア",
  "Palantir FDE", "AI実装支援", "AI導入支援", "AI伴走型",
  "ServiceNow FDE", "Salesforce Agentforce",
  // F. NotebookLM・AIノート
  "NotebookLM", "Notebook LM", "Google NotebookLM",
  "AI ノート", "AIノートブック",
  "Audio Overview", "オーディオオーバービュー",
  // G. RAI（Responsible AI）
  "RAI", "Responsible AI",
  "AI公平性", "AIバイアス", "AI透明性",
  "Explainable AI", "XAI", "AI監査",
  "Trustworthy AI", "信頼できるAI",
  // H. AIO（AI Optimization / AI運用最適化）
  "AIO", "AI Optimization", "AI最適化",
  "AIOps", "AI運用", "MLOps", "LLMOps",
  "AI基盤運用", "AI監視", "推論コスト",
  "AI Observability", "AI可観測性",
];

export async function fetchTrendingSearches(): Promise<TrendingKeyword[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return [];

  try {
    const params = new URLSearchParams({
      engine: "google_trends_trending_now",
      geo: "JP",
      hl: "ja",
      api_key: apiKey,
    });

    const res = await fetchWithTimeout(
      `${SERPAPI_BASE}?${params.toString()}`,
      {},
      TIMEOUT_MS,
    );

    if (!res.ok) {
      console.log(`[SerpApi] TrendingNow HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    const searches =
      (data as Record<string, unknown>).realtime_searches ??
      (data as Record<string, unknown>).trending_searches ??
      [];

    const items = (searches as Record<string, unknown>[])
      .filter((item) => {
        const title = String(item.query ?? item.title ?? "").toLowerCase();
        return AI_TREND_KEYWORDS.some((kw) => title.includes(kw.toLowerCase()));
      })
      .slice(0, 10)
      .map((item) => {
        const keyword = String(item.query ?? item.title ?? "");
        return {
          keyword,
          change: String(
            item.formatted_traffic ?? item.search_volume ?? "急上昇",
          ),
          hot: true,
          searchUrl: `https://www.google.com/search?q=${encodeURIComponent(keyword)}`,
        };
      });

    console.log(`[SerpApi] TrendingNow: ${items.length}件 (AI関連)`);
    return items;
  } catch (error) {
    console.log("[SerpApi] TrendingNow 失敗:", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// (C) 固定キーワードのトレンド比較（フォールバック）
// ---------------------------------------------------------------------------

const COMPARISON_QUERIES = [
  "生成AI,AIエージェント,マルチエージェント",
  "プロンプトエンジニアリング,自律型AI,AI駆動開発",
  "Claude Code,Cursor,Devin",
  "RAG,AIガバナンス,AI検索",
  "ChatGPT,Claude,Gemini",
  "AGI,ASI,汎用人工知能",
  "FDE,AIコンサルタント,AI導入支援",
  "NotebookLM,Perplexity,ChatGPT",
  "RAI,AIガバナンス,AI倫理",
  "AIOps,MLOps,LLMOps",
];

export async function fetchGoogleTrends(): Promise<TrendingKeyword[]> {
  // まず急上昇ワードを試す
  const trending = await fetchTrendingSearches();
  if (trending.length > 0) return trending;

  // フォールバック: 複数比較クエリ
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return [];

  const results: TrendingKeyword[] = [];

  for (const qStr of COMPARISON_QUERIES) {
    if (results.length >= 10) break;
    try {
      const params = new URLSearchParams({
        engine: "google_trends",
        q: qStr,
        api_key: apiKey,
      });

      const res = await fetchWithTimeout(
        `${SERPAPI_BASE}?${params.toString()}`,
        {},
        TIMEOUT_MS,
      );
      if (!res.ok) continue;

      const data = await res.json();
      const keywords = qStr.split(",");
      const timeline =
        ((data as Record<string, unknown>).interest_over_time as
          | { timeline_data?: { values: { value: number }[] }[] }
          | undefined)?.timeline_data ?? [];

      if (timeline.length === 0) continue;

      for (let i = 0; i < keywords.length; i++) {
        if (results.length >= 10) break;
        if (results.some((r) => r.keyword === keywords[i])) continue;

        const values = timeline
          .map((t) => t.values?.[i]?.value ?? 0)
          .filter((v) => v > 0);
        let change = "new";
        let hot = false;
        if (values.length >= 2) {
          const pct = Math.round(
            ((values[values.length - 1] - values[values.length - 2]) /
              values[values.length - 2]) * 100,
          );
          change = pct >= 0 ? `+${pct}%` : `${pct}%`;
          hot = pct > 50 || values[values.length - 1] >= 80;
        }
        results.push({
          keyword: keywords[i],
          change,
          hot,
          searchUrl: `https://www.google.com/search?q=${encodeURIComponent(keywords[i])}`,
        });
      }
    } catch {
      continue;
    }
  }

  console.log(`[SerpApi] Trends比較フォールバック: ${results.length}件`);
  return results;
}

// ---------------------------------------------------------------------------
// (D) 関連キーワード取得 (Google Autocomplete)
// ---------------------------------------------------------------------------

export async function fetchRelatedKeywords(
  keyword: string,
): Promise<{ keyword: string; searchUrl: string }[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return [];

  try {
    const params = new URLSearchParams({
      engine: "google_autocomplete",
      q: keyword,
      api_key: apiKey,
    });

    const res = await fetchWithTimeout(
      `${SERPAPI_BASE}?${params.toString()}`,
      {},
      5_000,
    );
    if (!res.ok) return [];

    const data = await res.json();
    const suggestions = ((data as Record<string, unknown>).suggestions ??
      []) as Record<string, unknown>[];

    return suggestions
      .map((s) => String(s.value ?? s.suggestion ?? ""))
      .filter((s) => s.length > 0)
      .slice(0, 5)
      .map((s) => ({
        keyword: s,
        searchUrl: `https://www.google.com/search?q=${encodeURIComponent(s)}`,
      }));
  } catch {
    return [];
  }
}

export default serpapi;
