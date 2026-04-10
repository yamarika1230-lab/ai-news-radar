import type { Collector, RawArticle } from "../types";
import { fetchWithTimeout } from "./utils";

const HN_API = "https://hacker-news.firebaseio.com/v0";

const AI_KEYWORDS =
  /\b(ai|llm|gpt|claude|openai|anthropic|ml|machine.?learning|transformer|neural|deep.?learning|diffusion|langchain|rag|embedding|fine.?tun|llama|mistral|gemini|copilot|stable.?diffusion|generative)\b/i;

interface HNItem {
  id: number;
  title: string;
  url?: string;
  score: number;
  by: string;
  time: number;
  descendants?: number;
  text?: string;
}

async function fetchItem(id: number): Promise<HNItem | null> {
  try {
    const res = await fetchWithTimeout(`${HN_API}/item/${id}.json`);
    return (await res.json()) as HNItem;
  } catch {
    return null;
  }
}

const hackernews: Collector = {
  name: "HackerNews",

  async collect(): Promise<RawArticle[]> {
    try {
      const res = await fetchWithTimeout(`${HN_API}/topstories.json`);
      const ids: number[] = await res.json();

      // 上位30件の詳細を並列取得
      const items = await Promise.all(ids.slice(0, 30).map(fetchItem));

      const articles = items
        .filter(
          (item): item is HNItem =>
            item !== null && !!item.url && AI_KEYWORDS.test(item.title),
        )
        .map((item) => ({
          title: item.title,
          url: item.url!,
          source: "HackerNews",
          content: item.text ?? "",
          score: item.score,
          comments: item.descendants ?? 0,
          publishedAt: new Date(item.time * 1000).toISOString(),
          metadata: { by: item.by, hnId: item.id },
        }));

      console.log(`[HackerNews] ${articles.length}件取得`);
      return articles;
    } catch (error) {
      console.log(`[HackerNews] 取得失敗:`, error);
      return [];
    }
  },
};

export default hackernews;
