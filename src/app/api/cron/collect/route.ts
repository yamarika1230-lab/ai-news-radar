import { NextResponse } from "next/server";
import hackernews from "@/lib/collectors/hackernews";
// import reddit from "@/lib/collectors/reddit"; // VercelのIPがRedditにブロックされるため無効化
import producthunt from "@/lib/collectors/producthunt";
import githubTrending from "@/lib/collectors/github-trending";
import arxiv from "@/lib/collectors/arxiv";
import rssBlogs from "@/lib/collectors/rss-blogs";
// import grok from "@/lib/collectors/grok"; // Grok → X API に置き換え
import xApi from "@/lib/collectors/x-api";
import serpapi from "@/lib/collectors/serpapi";
import { fetchGoogleTrends, fetchRelatedKeywords } from "@/lib/collectors/serpapi";
import { summarizeAndClassify, extractTrendingKeywords } from "@/lib/summarizer";
import { saveDailyDigest, updateSourceStatus } from "@/lib/storage";
import type { Collector, RawArticle, SourceStatus, TrendingKeyword } from "@/lib/types";
import dayjs from "dayjs";

// ---------------------------------------------------------------------------
// コレクター一覧
// ---------------------------------------------------------------------------

const collectors: Collector[] = [
  hackernews,
  // reddit, // 無効化（Vercel IPブロック）
  producthunt,
  githubTrending,
  arxiv,
  rssBlogs,
  xApi,
  serpapi,
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
  const seenUrls = new Set<string>();
  const seenTitles: string[] = [];

  return articles.filter((a) => {
    // URL 重複チェック
    const normalizedUrl = a.url.split("?")[0].replace(/\/+$/, "").toLowerCase();
    if (seenUrls.has(normalizedUrl)) return false;
    seenUrls.add(normalizedUrl);

    // タイトル類似度チェック（先頭30文字が同一なら重複とみなす）
    const titleKey = a.title.substring(0, 30).toLowerCase().replace(/\s+/g, "");
    if (titleKey.length > 10 && seenTitles.some((t) => t === titleKey)) return false;
    seenTitles.push(titleKey);

    return true;
  });
}

// ---------------------------------------------------------------------------
// ソースごとの記事数バランス調整
// ---------------------------------------------------------------------------

function balanceBySource(
  articles: RawArticle[],
  limits: Record<string, number>,
): RawArticle[] {
  const bySource: Record<string, RawArticle[]> = {};
  for (const a of articles) {
    const key = a.source;
    if (!bySource[key]) bySource[key] = [];
    bySource[key].push(a);
  }

  const result: RawArticle[] = [];
  for (const [source, items] of Object.entries(bySource)) {
    const limit = limits[source] ?? 5; // デフォルト5件
    // スコア順でソートして上位を選定
    const sorted = [...items].sort(
      (a, b) =>
        (b.score ?? 0) + (b.comments ?? 0) * 2 -
        ((a.score ?? 0) + (a.comments ?? 0) * 2),
    );
    const selected = sorted.slice(0, limit);
    result.push(...selected);
    if (items.length > limit) {
      console.log(
        `[cron] ${source}: ${items.length} → ${selected.length}件に制限`,
      );
    }
  }

  return result;
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
    const [collectorResults, serpTrends] = await Promise.all([
      runCollectorsWithTimeout(collectors),
      fetchGoogleTrends().catch((err) => {
        console.log("[cron] Google Trends 取得失敗:", err);
        return [] as TrendingKeyword[];
      }),
    ]);

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
    // 3.5. ソースごとの上限を適用してバランスを調整
    // -----------------------------------------------------------------------
    const SOURCE_LIMITS: Record<string, number> = {
      HackerNews: 5,
      ProductHunt: 4,
      GitHub: 5,
      arXiv: 5,
      "RSS/Blogs": 10,
      "Google News": 8,
      X: 20,
    };

    const balanced = balanceBySource(unique, SOURCE_LIMITS);
    console.log(
      `[cron] ソースバランス調整: ${unique.length} → ${balanced.length}件`,
    );

    // さらに全体で最大40件に絞る（スコア順）
    const MAX_ARTICLES = 40;
    const prioritized =
      balanced.length > MAX_ARTICLES
        ? [...balanced]
            .sort(
              (a, b) =>
                (b.score ?? 0) +
                (b.comments ?? 0) * 2 -
                ((a.score ?? 0) + (a.comments ?? 0) * 2),
            )
            .slice(0, MAX_ARTICLES)
        : balanced;

    if (balanced.length > MAX_ARTICLES) {
      console.log(
        `[cron] 上位${MAX_ARTICLES}件に絞り込み（${unique.length} → ${prioritized.length}）`,
      );
    }

    // -----------------------------------------------------------------------
    // 4. Claude API で要約・分類・スコアリング（リトライ1回）
    // -----------------------------------------------------------------------
    const allArticles = await withRetry(
      () => summarizeAndClassify(prioritized),
      "summarizeAndClassify",
    );

    // スコア20以下の低品質記事を除外
    const articles = allArticles.filter((a) => a.score > 20);
    if (allArticles.length !== articles.length) {
      console.log(
        `[cron] スコアフィルタ: ${allArticles.length} → ${articles.length}件（スコア20以下を${allArticles.length - articles.length}件除外）`,
      );
    }

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

    // 上位5キーワードの関連キーワードを取得
    for (let k = 0; k < Math.min(5, trendingKeywords.length); k++) {
      try {
        const related = await fetchRelatedKeywords(trendingKeywords[k].keyword);
        if (related.length > 0) {
          trendingKeywords[k].relatedKeywords = related;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch {
        // 関連キーワード取得失敗は無視
      }
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
