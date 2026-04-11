import type { Collector, RawArticle } from "../types";
import { fetchWithTimeout } from "./utils";

const CATEGORIES = "cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG";

async function searchArxiv(hours: number): Promise<RawArticle[]> {
  const res = await fetchWithTimeout(
    `http://export.arxiv.org/api/query?search_query=${CATEGORIES}&sortBy=submittedDate&sortOrder=descending&max_results=10`,
  );

  console.log(`[arXiv] APIレスポンスステータス: ${res.status}`);

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    console.log(`[arXiv] エラー: ${errorText.substring(0, 300)}`);
    return [];
  }

  const xml = await res.text();
  const entries = xml.split("<entry>").slice(1);
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const articles: RawArticle[] = [];

  for (const entry of entries) {
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim().replace(/\s+/g, " ") ?? "";
    const id = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() ?? "";
    const published = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.trim() ?? "";
    const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim().replace(/\s+/g, " ") ?? "";
    const authorMatches = entry.match(/<name>([\s\S]*?)<\/name>/g) ?? [];
    const authors = authorMatches.map((a) => a.replace(/<\/?name>/g, "").trim()).slice(0, 5).join(", ");
    const categoryMatches = entry.match(/category term="([^"]+)"/g) ?? [];
    const categories = categoryMatches.map((c) => c.replace(/category term="|"/g, ""));

    if (published && new Date(published).getTime() < cutoff) continue;

    articles.push({
      title,
      url: id,
      source: "arXiv",
      content: summary.slice(0, 500),
      publishedAt: published || new Date().toISOString(),
      metadata: { authors, categories, arxivId: id },
    });
  }

  return articles;
}

const arxiv: Collector = {
  name: "arXiv",

  async collect(): Promise<RawArticle[]> {
    try {
      // まず36時間以内で検索
      let articles = await searchArxiv(36);

      // 0件の場合は7日間に拡大
      if (articles.length === 0) {
        console.log("[arXiv] 36時間以内の結果が0件、7日間に拡大");
        articles = await searchArxiv(168);
      }

      console.log(`[arXiv] ${articles.length}件取得`);
      return articles;
    } catch (error) {
      console.log("[arXiv] 取得失敗:", error);
      return [];
    }
  },
};

export default arxiv;
