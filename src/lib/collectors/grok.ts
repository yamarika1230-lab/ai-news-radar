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
              content: `直近24時間にX上で話題になったAI関連の重要ニュースを10件教えてください。
各項目について、タイトル（日本語）と内容の要約（日本語、100文字程度）をJSON配列で返してください。
URLは不要です。正確なURLが分からない場合は含めないでください。
形式: [{"title": "...", "summary": "..."}]`,
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
      console.log("[Grok] コンテンツ先頭200文字:", content.substring(0, 200));

      // JSON抽出（3段階）
      let items: Record<string, unknown>[] = [];

      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) items = parsed;
      } catch { /* fall through */ }

      if (items.length === 0) {
        const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) {
          try {
            const parsed = JSON.parse(match[1].trim());
            if (Array.isArray(parsed)) items = parsed;
          } catch { /* fall through */ }
        }
      }

      if (items.length === 0) {
        const start = content.indexOf("[");
        const end = content.lastIndexOf("]");
        if (start !== -1 && end !== -1 && end > start) {
          try {
            const parsed = JSON.parse(content.substring(start, end + 1));
            if (Array.isArray(parsed)) items = parsed;
          } catch { /* fall through */ }
        }
      }

      if (items.length > 0) {
        console.log("[Grok] パース成功:", items.length, "件");
        return items.slice(0, 10).map((item) => {
          const title = String(item.title || "X上のAI関連投稿");
          return {
            title,
            url: `https://x.com/search?q=${encodeURIComponent(title)}&f=top`,
            source: "X (Grok)",
            content: String(item.summary || item.description || ""),
            publishedAt: new Date().toISOString(),
          };
        });
      }

      // フォールバック: テキスト全体を1件
      if (content.length > 50) {
        console.log("[Grok] JSONパース失敗、テキストを1件として返す");
        const title = "X上のAI最新動向まとめ（Grok分析）";
        return [
          {
            title,
            url: `https://x.com/search?q=${encodeURIComponent("AI LLM ニュース")}&f=top`,
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
