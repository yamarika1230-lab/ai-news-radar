import { NextRequest, NextResponse } from "next/server";
import { getDailyDigest, getLatestDigest } from "@/lib/storage";
import type { DailyDigest } from "@/lib/types";

// ---------------------------------------------------------------------------
// 共通レスポンスヘッダー
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const CACHE_HEADER = "public, s-maxage=300, stale-while-revalidate=60";

function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": CACHE_HEADER,
    },
  });
}

// ---------------------------------------------------------------------------
// CORS プリフライト
// ---------------------------------------------------------------------------

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

// ---------------------------------------------------------------------------
// GET /api/news?date=YYYY-MM-DD&category=llm
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const date = searchParams.get("date");
  const category = searchParams.get("category");

  try {
    // 日付指定がなければ最新のダイジェストを返す
    const digest: DailyDigest | null = date
      ? await getDailyDigest(date)
      : await getLatestDigest();

    // データが存在しない場合
    if (!digest) {
      return jsonResponse({
        date: date ?? "",
        lastUpdated: "",
        articles: [],
        trendingKeywords: [],
        sourceStatus: [],
      });
    }

    // カテゴリフィルター適用
    if (category) {
      return jsonResponse({
        ...digest,
        articles: digest.articles.filter((a) => a.category === category),
      });
    }

    console.log(`[API /news] 返却記事数: ${digest.articles.length}`);
    return jsonResponse(digest);
  } catch (error) {
    console.error("[api/news] エラー:", error);
    return jsonResponse(
      { error: "Failed to fetch news data" },
      500,
    );
  }
}
