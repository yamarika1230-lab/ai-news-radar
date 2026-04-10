import type { Collector, RawArticle } from "../types";
import { fetchWithTimeout } from "./utils";

// cs.AI (Artificial Intelligence), cs.CL (Computation and Language), cs.LG (Machine Learning)
const CATEGORIES = "cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG";

const arxiv: Collector = {
  name: "arXiv",

  async collect(): Promise<RawArticle[]> {
    try {
      const res = await fetchWithTimeout(
        `http://export.arxiv.org/api/query?search_query=${CATEGORIES}&sortBy=submittedDate&sortOrder=descending&max_results=10`,
      );

      if (!res.ok) {
        console.log(`[arXiv] HTTP ${res.status}`);
        return [];
      }

      const xml = await res.text();
      const entries = xml.split("<entry>").slice(1);

      // 直近24時間以内の論文のみ
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;

      const articles: RawArticle[] = [];

      for (const entry of entries) {
        const title =
          entry
            .match(/<title>([\s\S]*?)<\/title>/)?.[1]
            ?.trim()
            .replace(/\s+/g, " ") ?? "";
        const id =
          entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() ?? "";
        const published =
          entry
            .match(/<published>([\s\S]*?)<\/published>/)?.[1]
            ?.trim() ?? "";
        const summary =
          entry
            .match(/<summary>([\s\S]*?)<\/summary>/)?.[1]
            ?.trim()
            .replace(/\s+/g, " ") ?? "";
        const authorMatches =
          entry.match(/<name>([\s\S]*?)<\/name>/g) ?? [];
        const authors = authorMatches
          .map((a) => a.replace(/<\/?name>/g, "").trim())
          .slice(0, 5)
          .join(", ");
        const categoryMatches =
          entry.match(/category term="([^"]+)"/g) ?? [];
        const categories = categoryMatches.map((c) =>
          c.replace(/category term="|"/g, ""),
        );

        // 24時間フィルター
        if (published && new Date(published).getTime() < cutoff) {
          continue;
        }

        articles.push({
          title,
          url: id,
          source: "arXiv",
          content: summary.slice(0, 500),
          publishedAt: published || new Date().toISOString(),
          metadata: { authors, categories, arxivId: id },
        });
      }

      console.log(`[arXiv] ${articles.length}件取得`);
      return articles;
    } catch (error) {
      console.log(`[arXiv] 取得失敗:`, error);
      return [];
    }
  },
};

export default arxiv;
