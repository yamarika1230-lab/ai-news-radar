import xApi from "@/lib/collectors/x-api";

export async function GET() {
  try {
    const articles = await xApi.collect();
    return Response.json({
      success: true,
      collector: "X API",
      count: articles.length,
      articles: articles.slice(0, 3),
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
