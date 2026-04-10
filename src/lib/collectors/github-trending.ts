import type { Collector, RawArticle } from "../types";
import { fetchWithTimeout } from "./utils";

const TRENDING_API =
  "https://api.gitterapp.com/repositories?since=daily";

const AI_KEYWORDS =
  /\b(ai|llm|gpt|claude|openai|anthropic|ml|machine.?learning|transformer|neural|deep.?learning|diffusion|langchain|rag|embedding|fine.?tun|llama|mistral|generative|agent|prompt|vector)\b/i;

interface TrendingRepo {
  author: string;
  name: string;
  url: string;
  description: string;
  language: string;
  stars: number;
  currentPeriodStars: number;
}

const githubTrending: Collector = {
  name: "GitHub",

  async collect(): Promise<RawArticle[]> {
    try {
      const res = await fetchWithTimeout(TRENDING_API);

      if (!res.ok) {
        console.log(`[GitHub] HTTP ${res.status} — フォールバック`);
        return await fallbackCollect();
      }

      const repos: TrendingRepo[] = await res.json();

      const articles = repos
        .filter((repo) => {
          const text = `${repo.name} ${repo.description ?? ""}`;
          return AI_KEYWORDS.test(text);
        })
        .map((repo) => ({
          title: `${repo.author}/${repo.name}`,
          url: repo.url,
          source: "GitHub",
          content: repo.description ?? "",
          score: repo.stars,
          publishedAt: new Date().toISOString(),
          metadata: {
            language: repo.language,
            todayStars: repo.currentPeriodStars,
            author: repo.author,
          },
        }));

      console.log(`[GitHub] ${articles.length}件取得`);
      return articles;
    } catch (error) {
      console.log(`[GitHub] gitterapp API失敗、フォールバック:`, error);
      return await fallbackCollect();
    }
  },
};

/**
 * gitterapp API が落ちている場合の代替: GitHub Search API
 */
async function fallbackCollect(): Promise<RawArticle[]> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const res = await fetchWithTimeout(
      `https://api.github.com/search/repositories?q=created:>${since}+stars:>10+(ai+OR+llm+OR+machine-learning+OR+deep-learning+OR+transformer)&sort=stars&order=desc&per_page=25`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          ...(process.env.GITHUB_TOKEN
            ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
            : {}),
        },
      },
    );

    const json = await res.json();
    const repos: {
      full_name: string;
      html_url: string;
      description: string | null;
      stargazers_count: number;
      created_at: string;
      language: string | null;
      owner: { login: string };
    }[] = json?.items ?? [];

    const articles = repos.map((repo) => ({
      title: repo.full_name,
      url: repo.html_url,
      source: "GitHub",
      content: repo.description ?? "",
      score: repo.stargazers_count,
      publishedAt: repo.created_at,
      metadata: {
        language: repo.language,
        author: repo.owner.login,
      },
    }));

    console.log(`[GitHub/fallback] ${articles.length}件取得`);
    return articles;
  } catch (error) {
    console.log(`[GitHub/fallback] 取得失敗:`, error);
    return [];
  }
}

export default githubTrending;
