export async function GET() {
  const apiKey = process.env.XAI_API_KEY;

  // 環境変数チェック
  if (!apiKey) {
    return Response.json({ error: "XAI_API_KEY is not set" });
  }

  try {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-3-mini-fast",
        messages: [
          {
            role: "user",
            content:
              "直近24時間のAI関連の重要ニュースを3件だけ教えてください。各項目はtitle, summary, urlを含むJSON配列で返してください。",
          },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });

    const status = response.status;
    const body = await response.text();

    return Response.json({
      apiKeyPrefix: apiKey.substring(0, 8) + "...",
      responseStatus: status,
      responseBody: body.substring(0, 2000),
    });
  } catch (error: unknown) {
    return Response.json({
      apiKeyPrefix: apiKey.substring(0, 8) + "...",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
