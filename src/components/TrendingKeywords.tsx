"use client";

import type { TrendingKeyword } from "@/lib/types";

interface TrendingKeywordsProps {
  keywords: TrendingKeyword[];
}

export default function TrendingKeywords({ keywords }: TrendingKeywordsProps) {
  if (keywords.length === 0) {
    return (
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#A0A09C]">
          トレンドキーワード
        </h3>
        <p className="text-xs text-[#A0A09C]">データなし</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#A0A09C]">
        トレンドキーワード
      </h3>
      <div className="space-y-1.5">
        {keywords.map(({ keyword, change, hot }) => (
          <div
            key={keyword}
            className="flex items-center justify-between rounded-xl bg-white px-3 py-2"
          >
            <div className="flex items-center gap-2">
              {hot && (
                <span className="inline-block h-2 w-2 rounded-full bg-[#E07050]" />
              )}
              <span className="text-sm font-medium text-[#2D2D2D]">
                {keyword}
              </span>
            </div>
            <span
              className={`text-xs font-semibold ${
                change.startsWith("+") ? "text-[#2EAE8E]" : "text-[#E07050]"
              }`}
            >
              {change}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
