"use client";

import { useState, useEffect, useCallback } from "react";
import type { DailyDigest, ProcessedArticle } from "@/lib/types";
import Header from "./Header";
import Sidebar from "./Sidebar";
import NewsCard from "./NewsCard";

type LoadState = "loading" | "ready" | "error";

export default function Dashboard() {
  const [digest, setDigest] = useState<DailyDigest | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selectedCategory, setSelectedCategory] = useState<
    ProcessedArticle["category"] | null
  >(null);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoadState("loading");
      const params = new URLSearchParams();
      if (selectedCategory) params.set("category", selectedCategory);
      const res = await fetch(`/api/news?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: DailyDigest = await res.json();
      setDigest(json);
      setLoadState("ready");
    } catch (error) {
      console.error("[Dashboard] fetch failed:", error);
      setLoadState("error");
    }
  }, [selectedCategory]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [sidebarOpen]);

  const articles = digest?.articles ?? [];
  const trendingKeywords = digest?.trendingKeywords ?? [];
  const sourceStatus = digest?.sourceStatus ?? [];
  const activeSourceCount = sourceStatus.filter(
    (s) => s.status === "ok",
  ).length;

  // ソース名マッピング（ステータス名→記事のsource値群）
  const SOURCE_MAPPING: Record<string, string[]> = {
    HackerNews: ["HackerNews"],
    ProductHunt: ["ProductHunt"],
    GitHub: ["GitHub"],
    arXiv: ["arXiv"],
    "RSS/Blogs": [
      "RSS/Blogs", "OpenAI", "Google AI", "日経クロステック",
      "ITmedia AI+", "ZDNET Japan",
    ],
    X: ["X"],
    "Google News": ["Google News"],
  };

  // カテゴリ + ソース フィルタ（AND条件）
  const filteredArticles = articles.filter((a) => {
    if (selectedSource) {
      const matchingSources = SOURCE_MAPPING[selectedSource] ?? [selectedSource];
      if (!matchingSources.includes(a.source)) return false;
    }
    return true;
  });
  const sortedArticles = [...filteredArticles].sort(
    (a, b) => b.score - a.score,
  );

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        lastUpdated={digest?.lastUpdated ?? null}
        activeSourceCount={activeSourceCount}
        articleCount={articles.length}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
      />

      <div className="flex flex-1">
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/20 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside
          className={`
            fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto bg-[#F8F8F6] px-4 pb-6 pt-20
            transition-transform duration-200
            lg:sticky lg:top-0 lg:z-0 lg:h-screen lg:translate-x-0 lg:border-r lg:border-[#E8E8E4] lg:pt-6
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          `}
        >
          <div className="space-y-6">
            <Sidebar
              selectedCategory={selectedCategory}
              onCategoryChange={(cat) => {
                setSelectedCategory(cat);
                setSidebarOpen(false);
              }}
              selectedSource={selectedSource}
              onSourceChange={(src) => {
                setSelectedSource(src);
                setSidebarOpen(false);
              }}
              trendingKeywords={trendingKeywords}
              sourceStatus={sourceStatus}
            />
          </div>
        </aside>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {/* ソースフィルタバッジ */}
          {selectedSource && (
            <div className="mx-auto mb-4 max-w-3xl">
              <span className="inline-flex items-center gap-2 rounded-xl bg-[#F0EEFF] px-3 py-1.5 text-xs font-medium text-[#7C6FE0]">
                {selectedSource}の記事を表示中
                <button
                  type="button"
                  onClick={() => setSelectedSource(null)}
                  className="ml-1 rounded-full p-0.5 hover:bg-[#E0DCFF]"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            </div>
          )}

          {loadState === "loading" && <LoadingSkeleton />}
          {loadState === "error" && <ErrorState onRetry={fetchData} />}
          {loadState === "ready" && sortedArticles.length === 0 && (
            <EmptyState />
          )}
          {loadState === "ready" && sortedArticles.length > 0 && (
            <div className="mx-auto max-w-3xl space-y-3">
              {sortedArticles.map((article) => (
                <NewsCard key={article.id} article={article} />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-2xl bg-white p-4">
          <div className="flex gap-4">
            <div className="h-12 w-12 rounded-xl bg-[#F0F0EC]" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-[#F0F0EC]" />
              <div className="flex gap-2">
                <div className="h-3 w-16 rounded bg-[#F0F0EC]" />
                <div className="h-3 w-20 rounded bg-[#F0F0EC]" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#FFF0EC]">
        <svg className="h-8 w-8 text-[#E07050]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      </div>
      <h2 className="mb-2 text-lg font-semibold text-[#2D2D2D]">
        データの取得に失敗しました
      </h2>
      <p className="mb-6 text-sm text-[#6B6B68]">
        ネットワーク接続を確認し、再試行してください。
      </p>
      <button
        onClick={onRetry}
        className="rounded-xl bg-[#2D2D2D] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#444]"
      >
        再試行
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F0EEFF]">
        <svg className="h-8 w-8 text-[#7C6FE0]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
        </svg>
      </div>
      <h2 className="mb-2 text-lg font-semibold text-[#2D2D2D]">
        まだニュースがありません
      </h2>
      <p className="text-sm text-[#6B6B68]">
        Cronジョブが実行されるとニュースが表示されます。
      </p>
    </div>
  );
}
