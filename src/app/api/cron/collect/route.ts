import { NextResponse } from "next/server";
import hackernews from "@/lib/collectors/hackernews";
import reddit from "@/lib/collectors/reddit";
import producthunt from "@/lib/collectors/producthunt";
import githubTrending from "@/lib/collectors/github-trending";
import arxiv from "@/lib/collectors/arxiv";
import rssBlogs from "@/lib/collectors/rss-blogs";
// Phase 2 コレクター — Grok APIハング問題のため一時無効化
// import grok from "@/lib/collectors/grok";
// import serpapi from "@/lib/collectors/serpapi";
// import { fetchGoogleTrends } from "@/lib/collectors/serpapi";
import { summarizeAndClassify, extractTrendingKeywords } from "@/lib/summarizer";
import { saveDailyDigest, updateSourceStatus } from "@/lib/storage";
import type { Collector, RawArticle, SourceStatus, TrendingKeyword } from "@/lib/types";
import dayjs from "dayjs";

// ---------------------------------------------------------------------------
// コレクター一覧
// ---------------------------------------------------------------------------

const collectors: Collector[] = [
  hackernews,
  reddit,
  producthunt,
  githubTrending,
  arxiv,
  rssBlogs,
  // grok,     // Phase 2: 一時無効化（APIハング問題）
  // serpapi,   // Phase 2: 一時無効化（APIハング問題）
];

// ---------------------------------------------------------------------------
// セキュリティ: CRON_SECRET チェック
// ---------------------------------------------------------------------------

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

// ---------------------------------------------------------------------------
// URL ベースの重複除去
// ---------------------------------------------------------------------------

function deduplicateByUrl(articles: RawArticle[]): RawArticle[] {
  const seen = new Set<string>();
  return articles.filter((a) => {
    const normalized = a.url.split("?")[0].replace(/\/+$/, "").toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Claude API リトライラッパー（1回リトライ）
// ---------------------------------------------------------------------------

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.log(`[cron] ${label} 1回目失敗、リトライ中...`, error);
    return await fn();
  }
}

// ---------------------------------------------------------------------------
// 全コレクター並列実行（50秒グローバルタイムアウト付き）
// ---------------------------------------------------------------------------

const GLOBAL_TIMEOUT_MS = 50_000;

interface CollectorResult {
  name: string;
  articles: RawArticle[];
}

async function runCollectorsWithTimeout(
  collectorList: Collector[],
): Promise<CollectorResult[]> {
  // 各コレクターの Promise を個別に管理（完了済みの結果を保持するため）
  const completed: CollectorResult[] = [];

  const collectorPromises = collectorList.map(async (collector) => {
    try {
      const articles = await collector.collect();
      const result: CollectorResult = { name: collector.name, articles };
      completed.push(result);
      await updateSourceStatus({
        name: collector.name,
        status: articles.length > 0 ? "ok" : "warn",
        count: articles.length,
        lastRun: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      console.log(`[cron] ${collector.name} 収集失敗:`, error);
      const result: CollectorResult = {
        name: collector.name,
        articles: [],
      };
      completed.push(result);
      await updateSourceStatus({
        name: collector.name,
        status: "error",
        count: 0,
        lastRun: new Date().toISOString(),
      });
      return result;
    }
  });

  // グローバルタイムアウト
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("Global collector timeout (50s)")),
      GLOBAL_TIMEOUT_MS,
    ),
  );

  try {
    // 全コレクターが時間内に終われば allSettled の結果を使う
    await Promise.race([Promise.allSettled(collectorPromises), timeout]);
  } catch (error) {
    console.log(
      `[cron] グローバルタイムアウト — ${completed.length}/${collectorList.length} 完了済みで続行`,
    );
  }

  return completed;
}

// ---------------------------------------------------------------------------
// メインハンドラー
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    // -----------------------------------------------------------------------
    // 2. 全コレクターを並列実行 + Google Trends
    // -----------------------------------------------------------------------
    // Phase 2 の fetchGoogleTrends は一時無効化
    const serpTrends: TrendingKeyword[] = [];
    const collectorResults = await runCollectorsWithTimeout(collectors);

    // 結果を結合
    const allRaw: RawArticle[] = [];
    const sourceResults: Record<string, { status: string; count: number }> =
      {};

    for (const { name, articles } of collectorResults) {
      allRaw.push(...articles);
      sourceResults[name] = {
        status: articles.length > 0 ? "ok" : "warn",
        count: articles.length,
      };
    }

    console.log(`[cron] 全ソース合計: ${allRaw.length}件（重複除去前）`);

    // -----------------------------------------------------------------------
    // 3. URL ベースで重複除去
    // -----------------------------------------------------------------------
    const unique = deduplicateByUrl(allRaw);
    console.log(`[cron] 重複除去後: ${unique.length}件`);

    // -----------------------------------------------------------------------
    // 4. Claude API で要約・分類・スコアリング（リトライ1回）
    // -----------------------------------------------------------------------
    const articles = await withRetry(
      () => summarizeAndClassify(unique),
      "summarizeAndClassify",
    );

    // -----------------------------------------------------------------------
    // 5. トレンドキーワード:
    //    SerpApi の結果があればそれを優先、なければ Claude API で推定
    // -----------------------------------------------------------------------
    let trendingKeywords: TrendingKeyword[];

    if (serpTrends.length > 0) {
      console.log(
        `[cron] トレンドキーワード: Google Trends (${serpTrends.length}件)`,
      );
      trendingKeywords = serpTrends;
    } else {
      console.log("[cron] トレンドキーワード: Claude API で推定");
      trendingKeywords = await withRetry(
        () => extractTrendingKeywords(articles),
        "extractTrendingKeywords",
      );
    }

    // -----------------------------------------------------------------------
    // 6. ソースステータスを集計
    // -----------------------------------------------------------------------
    const sourceStatus: SourceStatus[] = collectors.map((c) => {
      const result = sourceResults[c.name];
      return {
        name: c.name,
        status: (result?.status as SourceStatus["status"]) ?? "error",
        count: result?.count ?? 0,
        lastRun: new Date().toISOString(),
      };
    });

    // -----------------------------------------------------------------------
    // 7. DailyDigest としてストレージに保存
    // -----------------------------------------------------------------------
    const today = dayjs().format("YYYY-MM-DD");

    await saveDailyDigest({
      date: today,
      lastUpdated: new Date().toISOString(),
      articles,
      trendingKeywords,
      sourceStatus,
    });

    // -----------------------------------------------------------------------
    // 8. レスポンス
    // -----------------------------------------------------------------------
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[cron] 完了: ${articles.length}件処理、${elapsed}秒`);

    return NextResponse.json({
      success: true,
      date: today,
      collected: {
        raw: allRaw.length,
        unique: unique.length,
        processed: articles.length,
      },
      trendingKeywords: trendingKeywords.length,
      trendingSource: serpTrends.length > 0 ? "google_trends" : "claude",
      sources: sourceResults,
      elapsedSeconds: Number(elapsed),
    });
  } catch (error) {
    console.error("[cron] 致命的エラー:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
