import { NextResponse } from "next/server";
import hackernews from "@/lib/collectors/hackernews";
import reddit from "@/lib/collectors/reddit";
import producthunt from "@/lib/collectors/producthunt";
import githubTrending from "@/lib/collectors/github-trending";
import arxiv from "@/lib/collectors/arxiv";
import rssBlogs from "@/lib/collectors/rss-blogs";
import { summarizeAndClassify, extractTrendingKeywords } from "@/lib/summarizer";
import { saveDailyDigest, updateSourceStatus } from "@/lib/storage";
import type { Collector, RawArticle, SourceStatus } from "@/lib/types";
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
];

// ---------------------------------------------------------------------------
// セキュリティ: CRON_SECRET チェック
// ---------------------------------------------------------------------------

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // CRON_SECRET が未設定ならスキップ（開発用）
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
    // URL を正規化（末尾スラッシュ・クエリパラメータの揺れを吸収）
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
// メインハンドラー
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  // 1. 認証チェック
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    // -----------------------------------------------------------------------
    // 2. 全コレクターを並列実行（Promise.allSettled）
    // -----------------------------------------------------------------------
    const settled = await Promise.allSettled(
      collectors.map(async (collector) => {
        try {
          const articles = await collector.collect();
          await updateSourceStatus({
            name: collector.name,
            status: articles.length > 0 ? "ok" : "warn",
            count: articles.length,
            lastRun: new Date().toISOString(),
          });
          return { name: collector.name, articles };
        } catch (error) {
          console.log(`[cron] ${collector.name} 収集失敗:`, error);
          await updateSourceStatus({
            name: collector.name,
            status: "error",
            count: 0,
            lastRun: new Date().toISOString(),
          });
          // エラーを握りつぶし、空結果として扱う
          return { name: collector.name, articles: [] as RawArticle[] };
        }
      }),
    );

    // 成功したソースの結果を結合
    const allRaw: RawArticle[] = [];
    const sourceResults: Record<string, { status: string; count: number }> = {};

    for (const result of settled) {
      // allSettled なので fulfilled のみ（catch 内で return しているため全て fulfilled）
      if (result.status === "fulfilled") {
        const { name, articles } = result.value;
        allRaw.push(...articles);
        sourceResults[name] = {
          status: articles.length > 0 ? "ok" : "warn",
          count: articles.length,
        };
      }
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
    // 5. トレンドキーワード抽出（リトライ1回）
    // -----------------------------------------------------------------------
    const trendingKeywords = await withRetry(
      () => extractTrendingKeywords(articles),
      "extractTrendingKeywords",
    );

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
      sources: sourceResults,
      elapsedSeconds: Number(elapsed),
    });
  } catch (error) {
    // 全体が失敗した場合
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
