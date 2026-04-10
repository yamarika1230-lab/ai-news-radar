import type { Collector, RawArticle } from "../types";

const grok: Collector = {
  name: "X (Grok)",

  async collect(): Promise<RawArticle[]> {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      console.log("[Grok] XAI_API_KEY が未設定のためスキップ");
      return [];
    }

    try {
      console.log("[Grok] API呼び出し開始");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

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
              content: `直近24時間にX（Twitter）上で話題になったAI・LLM関連の重要ニュースや投稿を10件リストアップしてください。

各項目を以下のJSON形式の配列で返してください。JSON配列のみを返し、他のテキストは含めないでください。

[
  {
    "title": "ニュースのタイトル（日本語）",
    "url": "関連するURL（投稿URLまたは記事URL）",
    "summary": "内容の要約（日本語、100文字程度）"
  }
]`,
            },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log("[Grok] レスポンスステータス:", response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.log("[Grok] エラー:", errorText.substring(0, 300));
        return [];
      }

      const data = await response.json();
      const content: string = data.choices?.[0]?.message?.content || "";

      console.log("[Grok] コンテンツ長:", content.length);
      console.log(
        "[Grok] コンテンツ先頭200文字:",
        content.substring(0, 200),
      );

      // JSON抽出を試みる（3段階）
      let items: Record<string, unknown>[] = [];

      // 方法1: そのままパース
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) items = parsed;
      } catch {
        /* fall through */
      }

      // 方法2: ```json ... ``` 内を抽出
      if (items.length === 0) {
        const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) {
          try {
            const parsed = JSON.parse(match[1].trim());
            if (Array.isArray(parsed)) items = parsed;
          } catch {
            /* fall through */
          }
        }
      }

      // 方法3: 最初の [ から最後の ] までを抽出
      if (items.length === 0) {
        const start = content.indexOf("[");
        const end = content.lastIndexOf("]");
        if (start !== -1 && end !== -1 && end > start) {
          try {
            const parsed = JSON.parse(content.substring(start, end + 1));
            if (Array.isArray(parsed)) items = parsed;
          } catch {
            /* fall through */
          }
        }
      }

      if (items.length > 0) {
        console.log("[Grok] パース成功:", items.length, "件");
        return items.slice(0, 10).map((item) => ({
          title: String(item.title || "X上のAI関連投稿"),
          url: String(item.url || "https://x.com"),
          source: "X (Grok)",
          content: String(item.summary || item.description || ""),
          publishedAt: new Date().toISOString(),
        }));
      }

      // フォールバック: テキスト全体を1件として返す
      if (content.length > 50) {
        console.log("[Grok] JSONパース失敗、テキストを1件として返す");
        return [
          {
            title: "X上のAI最新動向まとめ（Grok分析）",
            url: "https://x.com",
            source: "X (Grok)",
            content: content.substring(0, 1000),
            publishedAt: new Date().toISOString(),
          },
        ];
      }

      console.log("[Grok] データなし");
      return [];
    } catch (error) {
      console.log(
        "[Grok] エラー:",
        error instanceof Error ? error.message : error,
      );
      return [];
    }
  },
};

export default grok;
