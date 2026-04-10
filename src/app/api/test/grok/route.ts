import { NextResponse } from "next/server";
import grok from "@/lib/collectors/grok";

export async function GET() {
  const startTime = Date.now();

  // 15秒の全体タイムアウト
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const result = await Promise.race([
      grok.collect(),
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
      collector: grok.name,
      count: result.length,
      elapsedSeconds: Number(elapsed),
      articles: result,
    });
  } catch (error) {
    clearTimeout(timer);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    return NextResponse.json(
      {
        success: false,
        collector: grok.name,
        error: error instanceof Error ? error.message : "Unknown error",
        elapsedSeconds: Number(elapsed),
      },
      { status: 500 },
    );
  }
}
