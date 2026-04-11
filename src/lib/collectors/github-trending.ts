import type { Collector, RawArticle } from "../types";
import { fetchWithTimeout } from "./utils";

const AI_KEYWORDS =
  /\b(ai|llm|gpt|claude|openai|anthropic|ml|machine.?learning|transformer|neural|deep.?learning|diffusion|langchain|rag|embedding|fine.?tun|llama|mistral|generative|agent|prompt|vector)\b/i;

// ---------------------------------------------------------------------------
// 方法1: GitHub Search API（最も信頼性が高い）
// ---------------------------------------------------------------------------

async function searchGitHubRepos(): Promise<RawArticle[]> {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const dateStr = oneWeekAgo.toISOString().split("T")[0];

  const query = encodeURIComponent(
    `(AI OR LLM OR GPT OR Claude OR agent OR machine-learning) created:>${dateStr} stars:>5`,
  );
  const url = `https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=10`;

  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "AI-News-Radar/1.0",
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
    },
    10_000,
  );

  if (!res.ok) {
    throw new Error(`GitHub Search API ${res.status}`);
  }

  const data = await res.json();
  const repos = (data as { items?: Record<string, unknown>[] }).items ?? [];

  return repos.slice(0, 10).map((repo) => ({
    title: `${String(repo.full_name)}: ${String(repo.description ?? "")}`.substring(0, 200),
    url: String(repo.html_url),
    source: "GitHub",
    content: String(repo.description ?? ""),
    score: Number(repo.stargazers_count ?? 0),
    publishedAt: String(repo.created_at ?? new Date().toISOString()),
    metadata: {
      stars: Number(repo.stargazers_count ?? 0),
      language: String(repo.language ?? ""),
      forks: Number(repo.forks_count ?? 0),
    },
  }));
}

// ---------------------------------------------------------------------------
// 方法2: GitHub Trending 非公式 API（フォールバック）
// ---------------------------------------------------------------------------

interface TrendingRepo {
  author: string;
  name: string;
  url: string;
  description: string;
  language: string;
  stars: number;
  currentPeriodStars: number;
}

async function fetchGitHubTrending(): Promise<RawArticle[]> {
  const res = await fetchWithTimeout(
    "https://api.gitterapp.com/repositories?since=daily",
    {},
    10_000,
  );

  if (!res.ok) throw new Error(`Trending API ${res.status}`);

  const repos: TrendingRepo[] = await res.json();

  return repos
    .filter((repo) => {
      const text = `${repo.name} ${repo.description ?? ""}`;
      return AI_KEYWORDS.test(text);
    })
    .slice(0, 10)
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
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

const githubTrending: Collector = {
  name: "GitHub",

  async collect(): Promise<RawArticle[]> {
    // 方法1: GitHub Search API
    try {
      const articles = await searchGitHubRepos();
      if (articles.length > 0) {
        console.log(`[GitHub] Search APIで ${articles.length}件取得`);
        return articles;
      }
    } catch (e) {
      console.log(`[GitHub] Search API失敗: ${(e as Error).message}`);
    }

    // 方法2: Trending 非公式 API
    try {
      const articles = await fetchGitHubTrending();
      if (articles.length > 0) {
        console.log(`[GitHub] Trending APIで ${articles.length}件取得`);
        return articles;
      }
    } catch (e) {
      console.log(`[GitHub] Trending API失敗: ${(e as Error).message}`);
    }

    console.log("[GitHub] 全方法失敗、0件");
    return [];
  },
};

export default githubTrending;
