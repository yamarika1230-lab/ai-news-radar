"use client";

import { useState } from "react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/ja";
import type { ProcessedArticle } from "@/lib/types";

dayjs.extend(relativeTime);
dayjs.locale("ja");

// ---------------------------------------------------------------------------
// カテゴリ色設定
// ---------------------------------------------------------------------------

const CATEGORY_STYLE: Record<
  string,
  { color: string; bg: string; label: string }
> = {
  llm: { color: "#7C6FE0", bg: "#F0EEFF", label: "LLMモデル動向" },
  tools: { color: "#2EAE8E", bg: "#E6F8F3", label: "AIツール" },
  enterprise: { color: "#E07050", bg: "#FFF0EC", label: "企業AI活用" },
  tips: { color: "#D4A030", bg: "#FFF8E8", label: "AI Tips" },
  other: { color: "#7A7A70", bg: "#F0F0EC", label: "その他" },
};

const SOURCE_STYLE: Record<string, string> = {
  HackerNews: "#FF6600",
  Reddit: "#FF4500",
  ProductHunt: "#DA552F",
  GitHub: "#333333",
  arXiv: "#B31B1B",
  Anthropic: "#D4A27F",
  OpenAI: "#10A37F",
  "Google AI": "#4285F4",
  "Meta AI": "#0668E1",
  "Google News": "#4285F4",
  X: "#1DA1F2",
  "PR TIMES (AI)": "#0075C2",
  "日経クロステック": "#C41A30",
  "ITmedia AI+": "#E60033",
  "ZDNET Japan": "#0066CC",
  Qiita: "#55C500",
  note: "#41C9B4",
};

// ---------------------------------------------------------------------------
// スコアの背景色（パステル）
// ---------------------------------------------------------------------------

function scoreColor(score: number): string {
  if (score >= 80) return "bg-[#F0EEFF] text-[#7C6FE0]";
  if (score >= 60) return "bg-[#E6F8F3] text-[#2EAE8E]";
  if (score >= 40) return "bg-[#FFF8E8] text-[#D4A030]";
  return "bg-[#F0F0EC] text-[#7A7A70]";
}

function timeAgo(dateStr: string): string {
  return dayjs(dateStr).fromNow();
}

// ---------------------------------------------------------------------------
// コンポーネント
// ---------------------------------------------------------------------------

export default function NewsCard({ article }: { article: ProcessedArticle }) {
  const [expanded, setExpanded] = useState(false);

  const cat = CATEGORY_STYLE[article.category] ?? CATEGORY_STYLE.other;
  const sourceColor = SOURCE_STYLE[article.source] ?? "#6B6B68";
  const isEnglish =
    article.originalLanguage === "en" ||
    (!article.originalLanguage && /^[A-Za-z]/.test(article.title));

  return (
    <article className="rounded-2xl bg-white shadow-sm transition-shadow hover:shadow-md">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-start gap-4 p-4 text-left"
      >
        {/* スコア */}
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-lg font-bold ${scoreColor(article.score)}`}
        >
          {article.score}
        </div>

        {/* テキスト */}
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug text-[#2D2D2D]">
            {article.title}
            {isEnglish && (
              <span
                className="ml-1.5 inline-block align-middle text-xs opacity-60"
                title="英語の記事"
              >
                🌐
              </span>
            )}
          </h3>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* ソースバッジ */}
            <span
              className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium text-white"
              style={{ backgroundColor: sourceColor }}
            >
              {article.source}
            </span>

            {/* カテゴリバッジ */}
            <span
              className="rounded-lg px-2 py-0.5 text-[11px] font-medium"
              style={{ backgroundColor: cat.bg, color: cat.color }}
            >
              {cat.label}
            </span>

            {/* 経過時間 */}
            <span className="text-[11px] text-[#6B6B68]">
              {timeAgo(article.publishedAt)}
            </span>
          </div>
        </div>

        {/* 展開矢印 */}
        <svg
          className={`mt-1 h-5 w-5 shrink-0 text-[#C0C0BC] transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* 展開エリア */}
      {expanded && (
        <div className="border-t border-[#E8E8E4] px-4 pb-4 pt-3">
          {article.summary ? (
            <p className="mb-3 text-sm leading-relaxed text-[#6B6B68]">
              {article.summary}
            </p>
          ) : (
            <p className="mb-3 text-sm italic text-[#A0A09C]">
              要約を取得できませんでした。ソース記事をご確認ください。
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#2D2D2D] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#444]"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              {article.source === "X" ? "Xの投稿を見る" : "ソース記事を開く"}
            </a>
            <span className="max-w-xs truncate text-[11px] text-[#A0A09C]">
              {article.url}
            </span>
          </div>
        </div>
      )}
    </article>
  );
}
