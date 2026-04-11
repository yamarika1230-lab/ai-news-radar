import type { Collector, RawArticle } from "../types";

const SEARCH_QUERIES = ["AI", "ChatGPT", "Claude", "生成AI", "LLM"];
const TIMEOUT_MS = 10_000;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// 方法1: note 検索 API (v3)
// ---------------------------------------------------------------------------

async function trySearchApi(): Promise<RawArticle[]> {
  const articles: RawArticle[] = [];

  for (const query of SEARCH_QUERIES) {
    try {
      const url = `https://note.com/api/v3/searches?q=${encodeURIComponent(query)}&size=5&sort=new&start=0&context=note`;
      const res = await fetch(url, {
        headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      console.log(`[note] API v3 "${query}" → ${res.status}`);
      if (!res.ok) continue;

      const data = await res.json();
      const d = data as Record<string, unknown>;
      const inner = d.data as Record<string, unknown> | undefined;
      const notes = (inner?.notes ?? inner?.contents ?? []) as Record<
        string,
        unknown
      >[];

      for (const note of notes) {
        const pub = String(note.publish_at ?? note.created_at ?? "");
        if (pub && !isRecent(pub, 72)) continue;

        const user = note.user as Record<string, unknown> | undefined;
        const urlname = String(user?.urlname ?? "");
        const key = String(note.key ?? note.id ?? "");

        articles.push({
          title: String(note.name ?? note.title ?? ""),
          url: urlname && key ? `https://note.com/${urlname}/n/${key}` : "",
          source: "note",
          content: String(note.body ?? note.description ?? note.excerpt ?? "").substring(0, 500),
          score: Number(note.like_count ?? note.likeCount ?? 0),
          publishedAt: pub || new Date().toISOString(),
          metadata: {
            author: String(user?.name ?? user?.urlname ?? ""),
            likes: Number(note.like_count ?? note.likeCount ?? 0),
          },
        });
      }

      await new Promise((r) => setTimeout(r, 300));
    } catch (e) {
      console.log(`[note] API v3 "${query}" 失敗:`, (e as Error).message);
    }
  }

  return articles;
}

// ---------------------------------------------------------------------------
// 方法2: note 検索ページの __NEXT_DATA__ から抽出
// ---------------------------------------------------------------------------

async function tryHtmlScrape(): Promise<RawArticle[]> {
  const articles: RawArticle[] = [];

  for (const query of SEARCH_QUERIES.slice(0, 2)) {
    try {
      const url = `https://note.com/search?q=${encodeURIComponent(query)}&sort=new&type=note`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html",
          "Accept-Language": "ja",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      console.log(`[note] HTML "${query}" → ${res.status}`);
      if (!res.ok) continue;

      const html = await res.text();
      const m = html.match(
        /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
      );
      if (!m) {
        console.log(`[note] __NEXT_DATA__ not found, html length=${html.length}`);
        continue;
      }

      const nd = JSON.parse(m[1]) as Record<string, unknown>;
      const pp = (nd.props as Record<string, unknown>)?.pageProps as
        | Record<string, unknown>
        | undefined;
      const notes = (pp?.notes ??
        (pp?.searchResult as Record<string, unknown> | undefined)?.notes ??
        (pp?.data as Record<string, unknown> | undefined)?.notes ??
        []) as Record<string, unknown>[];

      console.log(`[note] __NEXT_DATA__ → ${notes.length}件`);

      for (const note of notes) {
        const user = note.user as Record<string, unknown> | undefined;
        articles.push({
          title: String(note.name ?? note.title ?? ""),
          url: String(
            note.noteUrl ??
              `https://note.com/${String(user?.urlname ?? "")}/n/${String(note.key ?? note.id ?? "")}`,
          ),
          source: "note",
          content: String(note.body ?? note.description ?? note.excerpt ?? "").substring(0, 500),
          score: Number(note.likeCount ?? note.like_count ?? 0),
          publishedAt: String(note.publish_at ?? note.publishAt ?? note.created_at ?? new Date().toISOString()),
          metadata: {
            author: String(user?.name ?? user?.nickname ?? ""),
          },
        });
      }

      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      console.log(`[note] HTML "${query}" 失敗:`, (e as Error).message);
    }
  }

  return articles;
}

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function isRecent(dateStr: string, hours: number): boolean {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return true;
  return (Date.now() - d.getTime()) / 3_600_000 <= hours;
}

function dedup(articles: RawArticle[]): RawArticle[] {
  const seen = new Set<string>();
  return articles.filter((a) => {
    if (!a.title || !a.url || seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

const noteCollector: Collector = {
  name: "note",

  async collect(): Promise<RawArticle[]> {
    console.log("[note] 記事取得開始");

    // 方法1: API
    let articles = await trySearchApi();
    if (articles.length > 0) {
      const unique = dedup(articles);
      console.log(`[note] API成功: ${unique.length}件`);
      return unique.slice(0, 10);
    }

    // 方法2: HTML scrape
    console.log("[note] API 0件 → HTML抽出を試行");
    articles = await tryHtmlScrape();
    if (articles.length > 0) {
      const unique = dedup(articles);
      console.log(`[note] HTML成功: ${unique.length}件`);
      return unique.slice(0, 10);
    }

    console.log("[note] 全方法失敗: 0件");
    return [];
  },
};

export default noteCollector;
