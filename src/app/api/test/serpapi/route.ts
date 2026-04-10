import { NextResponse } from "next/server";
import serpapi from "@/lib/collectors/serpapi";
import { fetchGoogleTrends } from "@/lib/collectors/serpapi";

export async function GET() {
  const startTime = Date.now();

  // 15秒の全体タイムアウト
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const [articles, trends] = await Promise.race([
      Promise.all([serpapi.collect(), fetchGoogleTrends()]),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new Error("Test timeout (15s)")),
        );
      }),
    ]);

    clearTimeout(timer);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    return NextResponse.json({
      success: true,
      collector: serpapi.name,
      elapsedSeconds: Number(elapsed),
      news: {
        count: articles.length,
        articles,
      },
      trends: {
        count: trends.length,
        keywords: trends,
      },
    });
  } catch (error) {
    clearTimeout(timer);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    return NextResponse.json(
      {
        success: false,
        collector: serpapi.name,
        error: error instanceof Error ? error.message : "Unknown error",
        elapsedSeconds: Number(elapsed),
      },
      { status: 500 },
    );
  }
}
