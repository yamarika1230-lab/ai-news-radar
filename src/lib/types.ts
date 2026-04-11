/** 収集した生データの型 */
export interface RawArticle {
  title: string;
  url: string;
  source: string;
  content: string;
  score?: number;
  comments?: number;
  publishedAt: string;
  metadata?: Record<string, unknown>;
}

/** Claude APIで整形後のデータの型 */
export interface ProcessedArticle {
  id: string;
  title: string;
  url: string;
  source: string;
  summary: string;
  category: "llm" | "tools" | "enterprise" | "tips" | "other";
  score: number;
  publishedAt: string;
  collectedAt: string;
  originalLanguage?: "en" | "ja" | "other";
}

/** トレンドキーワード */
export interface TrendingKeyword {
  keyword: string;
  change: string;
  hot: boolean;
  searchUrl?: string;
  relatedKeywords?: { keyword: string; searchUrl: string }[];
}

/** ソースステータス */
export interface SourceStatus {
  name: string;
  status: "ok" | "warn" | "error";
  count: number;
  lastRun: string;
}

/** コレクター共通インターフェース */
export interface Collector {
  name: string;
  collect(): Promise<RawArticle[]>;
}

/** ダッシュボードに渡すデータ全体の型 */
export interface DailyDigest {
  date: string;
  lastUpdated: string;
  articles: ProcessedArticle[];
  trendingKeywords: TrendingKeyword[];
  sourceStatus: SourceStatus[];
}
