import type { Collector, RawArticle } from "../types";
import { isWithinHours } from "../utils";

const SEARCH_QUERIES = ["AI", "ChatGPT", "Claude", "生成AI", "LLM"];
const TIMEOUT_MS = 10_000;

const noteCollector: Collector = {
  name: "note",

  async collect(): Promise<RawArticle[]> {
    console.log("[note] 記事取得開始");
    const allArticles: RawArticle[] = [];

    for (const query of SEARCH_QUERIES) {
      try {
        const url = `https://note.com/api/v3/searches?q=${encodeURIComponent(query)}&size=5&sort=new&start=0&context=note`;

        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; AI-News-Radar/1.0)",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        console.log(`[note] 検索 "${query}" ステータス: ${response.status}`);

        if (!response.ok) continue;

        const data = await response.json();
        const d = data as Record<string, unknown>;
        const dataInner = d.data as Record<string, unknown> | undefined;
        const notes = (dataInner?.notes ??
          dataInner?.contents ??
          []) as Record<string, unknown>[];

        for (const note of notes) {
          const publishedAt = String(
            note.publish_at ?? note.created_at ?? "",
          );
          if (!publishedAt || !isWithinHours(publishedAt, 36)) continue;

          const user = note.user as Record<string, unknown> | undefined;
          const urlname = String(user?.urlname ?? note.user_id ?? "");
          const key = String(note.key ?? note.id ?? "");

          allArticles.push({
            title: String(note.name ?? note.title ?? ""),
            url: urlname && key
              ? `https://note.com/${urlname}/n/${key}`
              : "",
            source: "note",
            content: String(
              note.body ?? note.description ?? note.excerpt ?? "",
            ).substring(0, 500),
            score: Number(note.like_count ?? note.likeCount ?? 0),
            publishedAt,
            metadata: {
              author: String(user?.name ?? user?.urlname ?? ""),
              likes: Number(note.like_count ?? note.likeCount ?? 0),
            },
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (e) {
        console.log(`[note] 検索失敗 "${query}":`, (e as Error).message);
      }
    }

    // URL 重複除去
    const seen = new Set<string>();
    const unique = allArticles.filter((a) => {
      if (!a.title || !a.url || seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });

    console.log(`[note] 合計 ${unique.length}件取得（重複除去後）`);
    return unique.slice(0, 10);
  },
};

export default noteCollector;
