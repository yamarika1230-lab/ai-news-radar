"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { DailyDigest } from "@/lib/types";
import NewsCard from "@/components/NewsCard";

export default function ArchivePage() {
  const [days, setDays] = useState<DailyDigest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchArchive() {
      try {
        const results: DailyDigest[] = [];
        for (let i = 1; i <= 7; i++) {
          const date = new Date(Date.now() - i * 86400000)
            .toISOString()
            .split("T")[0];
          const res = await fetch(`/api/news?date=${date}`);
          const data: DailyDigest = await res.json();
          if (data.articles?.length > 0) {
            results.push(data);
          }
        }
        setDays(results);
      } catch (error) {
        console.error("Failed to fetch archive:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchArchive();
  }, []);

  return (
    <div className="min-h-screen bg-[#F8F8F6]">
      {/* ヘッダー */}
      <header className="flex items-center justify-between border-b border-[#E8E8E4] bg-white px-4 py-3 sm:px-6">
        <h1 className="text-lg font-bold text-[#2D2D2D]">AI News Radar</h1>
        <nav className="flex items-center gap-4 text-sm">
          <Link
            href="/"
            className="text-[#6B6B68] transition-colors hover:text-[#2D2D2D]"
          >
            Today
          </Link>
          <Link
            href="/archive"
            className="font-semibold text-[#7C6FE0]"
          >
            Archive
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h2 className="mb-6 text-xl font-bold text-[#2D2D2D]">
          過去のニュース
        </h2>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-2xl bg-white p-4">
                <div className="h-4 w-1/3 rounded bg-[#F0F0EC]" />
              </div>
            ))}
          </div>
        ) : days.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-[#E8E8E4] p-12 text-center">
            <p className="text-sm text-[#A0A09C]">
              アーカイブされたニュースはありません。
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {days.map((day) => (
              <section key={day.date}>
                <div className="mb-4 flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-[#2D2D2D]">
                    {day.date}
                  </h3>
                  <span className="rounded-xl bg-[#F0EEFF] px-2.5 py-0.5 text-xs font-medium text-[#7C6FE0]">
                    {day.articles.length}件
                  </span>
                </div>
                <div className="space-y-3">
                  {day.articles
                    .sort((a, b) => b.score - a.score)
                    .map((article) => (
                      <NewsCard key={article.id} article={article} />
                    ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
