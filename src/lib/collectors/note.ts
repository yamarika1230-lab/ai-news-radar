import type { Collector, RawArticle } from "../types";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const noteCollector: Collector = {
  name: "note",

  async collect(): Promise<RawArticle[]> {
    const allArticles: RawArticle[] = [];
    const queries = ["AI", "生成AI", "ChatGPT", "Claude", "LLM"];

    for (const query of queries) {
      // --- 方法1: note API v3 ---
      if (allArticles.length === 0) {
        try {
          const apiUrl = `https://note.com/api/v3/searches?q=${encodeURIComponent(query)}&size=10&sort=new&start=0&context=note`;
          console.log("[note] API v3試行:", query);
          const res = await fetch(apiUrl, {
            headers: {
              "User-Agent": BROWSER_UA,
              Accept: "application/json",
              Referer: "https://note.com/",
            },
            signal: AbortSignal.timeout(8000),
          });
          console.log("[note] API v3 status:", res.status);
          if (res.ok) {
            const text = await res.text();
            console.log(
              "[note] API v3 response length:",
              text.length,
              "先頭200:",
              text.substring(0, 200),
            );
            try {
              const data = JSON.parse(text);
              const notes =
                data?.data?.notes ??
                data?.data?.contents ??
                data?.data ??
                [];
              if (Array.isArray(notes) && notes.length > 0) {
                console.log("[note] API v3 成功:", notes.length, "件");
                for (const n of notes as Record<string, unknown>[]) {
                  const user = n.user as Record<string, unknown> | undefined;
                  allArticles.push({
                    title: String(n.name ?? n.title ?? ""),
                    url: String(
                      n.noteUrl ??
                        `https://note.com/${String(user?.urlname ?? "unknown")}/n/${String(n.key ?? n.id ?? "")}`,
                    ),
                    source: "note",
                    content: String(
                      n.body ?? n.description ?? n.excerpt ?? "",
                    ).substring(0, 500),
                    score: Number(n.likeCount ?? n.like_count ?? 0),
                    publishedAt: String(
                      n.publish_at ??
                        n.publishAt ??
                        n.created_at ??
                        new Date().toISOString(),
                    ),
                  });
                }
              }
            } catch (e) {
              console.log(
                "[note] API v3 JSONパース失敗:",
                (e as Error).message,
              );
            }
          }
        } catch (e) {
          console.log("[note] API v3 失敗:", (e as Error).message);
        }
      }

      // --- 方法2: note API v2 ---
      if (allArticles.length === 0) {
        try {
          const apiUrl = `https://note.com/api/v2/search?q=${encodeURIComponent(query)}&size=10&sort=new`;
          console.log("[note] API v2試行:", query);
          const res = await fetch(apiUrl, {
            headers: {
              "User-Agent": BROWSER_UA,
              Accept: "application/json",
              Referer: "https://note.com/",
            },
            signal: AbortSignal.timeout(8000),
          });
          console.log("[note] API v2 status:", res.status);
          if (res.ok) {
            const text = await res.text();
            console.log(
              "[note] API v2 response length:",
              text.length,
              "先頭200:",
              text.substring(0, 200),
            );
            try {
              const data = JSON.parse(text);
              const notes =
                data?.data?.notes ??
                data?.data?.contents ??
                data?.data ??
                [];
              if (Array.isArray(notes) && notes.length > 0) {
                console.log("[note] API v2 成功:", notes.length, "件");
                for (const n of notes as Record<string, unknown>[]) {
                  const user = n.user as Record<string, unknown> | undefined;
                  allArticles.push({
                    title: String(n.name ?? n.title ?? ""),
                    url: String(
                      n.noteUrl ??
                        `https://note.com/${String(user?.urlname ?? "unknown")}/n/${String(n.key ?? n.id ?? "")}`,
                    ),
                    source: "note",
                    content: String(
                      n.body ?? n.description ?? n.excerpt ?? "",
                    ).substring(0, 500),
                    score: Number(n.likeCount ?? n.like_count ?? 0),
                    publishedAt: String(
                      n.publish_at ??
                        n.publishAt ??
                        n.created_at ??
                        new Date().toISOString(),
                    ),
                  });
                }
              }
            } catch (e) {
              console.log(
                "[note] API v2 JSONパース失敗:",
                (e as Error).message,
              );
            }
          }
        } catch (e) {
          console.log("[note] API v2 失敗:", (e as Error).message);
        }
      }

      // --- 方法3: note RSS ---
      if (allArticles.length === 0) {
        try {
          const rssUrl = `https://note.com/hashtag/${encodeURIComponent(query)}?rss`;
          console.log("[note] RSS試行:", rssUrl);
          const res = await fetch(rssUrl, {
            headers: {
              "User-Agent": BROWSER_UA,
              Accept: "application/xml, text/xml, application/rss+xml",
            },
            signal: AbortSignal.timeout(8000),
          });
          console.log("[note] RSS status:", res.status);
          if (res.ok) {
            const text = await res.text();
            console.log(
              "[note] RSS response length:",
              text.length,
              "先頭200:",
              text.substring(0, 200),
            );
            const items: { title: string; link: string }[] = [];
            // CDATA パターン
            const r1 =
              /<item>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<\/item>/g;
            let m;
            while ((m = r1.exec(text)) !== null) {
              items.push({ title: m[1], link: m[2] });
            }
            // CDATAなし
            if (items.length === 0) {
              const r2 =
                /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<\/item>/g;
              while ((m = r2.exec(text)) !== null) {
                items.push({ title: m[1], link: m[2] });
              }
            }
            console.log("[note] RSS パース結果:", items.length, "件");
            for (const item of items) {
              allArticles.push({
                title: item.title,
                url: item.link,
                source: "note",
                content: "",
                publishedAt: new Date().toISOString(),
              });
            }
          }
        } catch (e) {
          console.log("[note] RSS 失敗:", (e as Error).message);
        }
      }

      if (allArticles.length >= 5) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    // 重複除去
    const seen = new Set<string>();
    const unique = allArticles.filter((a) => {
      if (!a.title || !a.url || seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });

    console.log("[note] 最終結果:", unique.length, "件");
    return unique.slice(0, 10);
  },
};

export default noteCollector;
