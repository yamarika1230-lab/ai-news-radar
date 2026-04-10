import { collectXApi } from "@/lib/collectors/x-api";

export async function GET() {
  const token = process.env.X_BEARER_TOKEN;
  console.log("[X API Test] Bearer Token exists:", !!token);

  try {
    const articles = await collectXApi();
    console.log("[X API Test] 結果:", articles.length, "件");
    return Response.json({
      success: true,
      collector: "X API",
      tokenExists: !!token,
      count: articles.length,
      articles: articles.slice(0, 3),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log("[X API Test] エラー:", msg);
    return Response.json({ error: msg, tokenExists: !!token });
  }
}
