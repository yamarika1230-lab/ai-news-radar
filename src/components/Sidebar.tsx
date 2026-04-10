"use client";

import type { ProcessedArticle, TrendingKeyword, SourceStatus as SourceStatusType } from "@/lib/types";
import TrendingKeywords from "./TrendingKeywords";
import SourceStatusComp from "./SourceStatus";

// ---------------------------------------------------------------------------
// カテゴリ定義
// ---------------------------------------------------------------------------

const CATEGORIES: {
  value: ProcessedArticle["category"] | null;
  label: string;
  color: string;
  bg: string;
}[] = [
  { value: null, label: "すべて", color: "#2D2D2D", bg: "#F0F0EC" },
  { value: "llm", label: "LLMモデル動向", color: "#7C6FE0", bg: "#F0EEFF" },
  { value: "tools", label: "AIツール・サービス", color: "#2EAE8E", bg: "#E6F8F3" },
  { value: "enterprise", label: "企業のAI活用", color: "#E07050", bg: "#FFF0EC" },
  { value: "tips", label: "AI活用Tips", color: "#D4A030", bg: "#FFF8E8" },
  { value: "other", label: "その他", color: "#7A7A70", bg: "#F0F0EC" },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SidebarProps {
  selectedCategory: ProcessedArticle["category"] | null;
  onCategoryChange: (category: ProcessedArticle["category"] | null) => void;
  trendingKeywords: TrendingKeyword[];
  sourceStatus: SourceStatusType[];
}

export default function Sidebar({
  selectedCategory,
  onCategoryChange,
  trendingKeywords,
  sourceStatus,
}: SidebarProps) {
  return (
    <>
      {/* カテゴリフィルター */}
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#A0A09C]">
          カテゴリ
        </h3>
        <div className="space-y-1">
          {CATEGORIES.map((cat) => {
            const isActive = selectedCategory === cat.value;
            return (
              <button
                key={cat.label}
                onClick={() => onCategoryChange(cat.value)}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors"
                style={{
                  backgroundColor: isActive ? cat.bg : "transparent",
                  color: isActive ? cat.color : "#6B6B68",
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                {cat.value && (
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: cat.color }}
                  />
                )}
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 区切り */}
      <div className="h-px bg-[#E8E8E4]" />

      {/* トレンドキーワード */}
      <TrendingKeywords keywords={trendingKeywords} />

      {/* 区切り */}
      <div className="h-px bg-[#E8E8E4]" />

      {/* ソースステータス */}
      <SourceStatusComp statuses={sourceStatus} />
    </>
  );
}
