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
import qiita from "@/lib/collectors/qiita";
// import noteCollector from "@/lib/collectors/note"; // VercelのIPがnoteにブロック
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
  qiita,
  // noteCollector, // 無効化（VercelのIPがnoteにブロックされるため）
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
    const limit = limits[source] ?? 15; // デフォルト15件
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

    console.log("[cron] === 記事数追跡 ===");
    console.log(`[cron] 1. 全ソース収集後: ${allRaw.length}件`);

    // -----------------------------------------------------------------------
    // 3. URL ベースで重複除去
    // -----------------------------------------------------------------------
    const unique = deduplicateByUrl(allRaw);
    console.log(`[cron] 2. 重複除去後: ${unique.length}件`);

    // -----------------------------------------------------------------------
    // 3.5. ソースごとの上限を適用してバランスを調整
    // -----------------------------------------------------------------------
    const SOURCE_LIMITS: Record<string, number> = {
      HackerNews: 10,
      ProductHunt: 10,
      GitHub: 10,
      arXiv: 10,
      "RSS/Blogs": 15,
      "Google News": 10,
      X: 20,
      Qiita: 10,
      note: 10,
      "日経クロステック": 15,
      OpenAI: 10,
      "OpenAI Blog": 10,
      "Google AI": 10,
      "ITmedia AI+": 10,
      "ZDNET Japan": 10,
    };

    const balanced = balanceBySource(unique, SOURCE_LIMITS);
    console.log(`[cron] 3. ソースバランス調整後: ${balanced.length}件`);

    // さらに全体で最大100件に絞る（スコア順）
    const MAX_ARTICLES = 100;
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

    console.log(`[cron] 4. Summarizer入力: ${prioritized.length}件`);

    // -----------------------------------------------------------------------
    // 4. Claude API で要約・分類・スコアリング（リトライ1回）
    // -----------------------------------------------------------------------
    const allArticles = await withRetry(
      () => summarizeAndClassify(prioritized),
      "summarizeAndClassify",
    );

    console.log(`[cron] 5. Summarizer出力: ${allArticles.length}件`);

    // スコア20以下の低品質記事を除外
    const articles = allArticles.filter((a) => a.score > 20);
    console.log(`[cron] 6. スコアフィルタ後: ${articles.length}件`);

    // ソース別件数の内訳
    const sourceCounts: Record<string, number> = {};
    articles.forEach((a) => {
      sourceCounts[a.source] = (sourceCounts[a.source] ?? 0) + 1;
    });
    console.log(`[cron] ソース別件数: ${JSON.stringify(sourceCounts)}`);

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

    // 急上昇率で降順ソート
    trendingKeywords.sort((a, b) => {
      const extractNum = (change: string): number => {
        if (change.includes("急上昇") || change.includes("Breakout")) return 9999;
        const m = change.match(/([+-]?\d+)/);
        return m ? parseInt(m[1]) : 0;
      };
      return extractNum(b.change) - extractNum(a.change);
    });

    // 上位10キーワードの関連キーワードを取得（API上限ガード付き）
    const maxRelatedQueries = 10;
    let queriesUsed = 0;
    for (let k = 0; k < Math.min(10, trendingKeywords.length); k++) {
      if (queriesUsed >= maxRelatedQueries) {
        console.log("[Trends] 関連キーワード取得上限到達、残りはスキップ");
        break;
      }
      try {
        const related = await fetchRelatedKeywords(trendingKeywords[k].keyword);
        if (related.length > 0) {
          trendingKeywords[k].relatedKeywords = related;
        }
        queriesUsed++;
      } catch {
        console.log(`[Trends] 関連キーワード取得失敗: ${trendingKeywords[k].keyword}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
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

    // ストレージ保存前の最終件数
    const saveCounts: Record<string, number> = {};
    articles.forEach((a) => {
      saveCounts[a.source] = (saveCounts[a.source] ?? 0) + 1;
    });
    console.log(`[cron] 7. ストレージ保存件数: ${articles.length}`);
    console.log(`[cron] 保存ソース別: ${JSON.stringify(saveCounts)}`);

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
