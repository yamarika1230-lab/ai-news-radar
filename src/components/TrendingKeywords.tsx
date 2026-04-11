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
        {keywords.map(({ keyword, change, hot, searchUrl, relatedKeywords }) => (
          <div key={keyword} className="rounded-xl bg-white px-3 py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {hot && (
                  <span className="inline-block h-2 w-2 rounded-full bg-[#E07050]" />
                )}
                <a
                  href={
                    searchUrl ??
                    `https://www.google.com/search?q=${encodeURIComponent(keyword)}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-[#2D2D2D] hover:text-[#7C6FE0] transition-colors"
                >
                  {keyword}
                </a>
              </div>
              <span
                className={`text-xs font-semibold ${
                  change.startsWith("+") || change === "急上昇"
                    ? "text-[#2EAE8E]"
                    : "text-[#E07050]"
                }`}
              >
                {change}
              </span>
            </div>
            {relatedKeywords && relatedKeywords.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 pl-4">
                {relatedKeywords.map((rk) => (
                  <a
                    key={rk.keyword}
                    href={rk.searchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-[#A0A09C] hover:text-[#6B6B68] transition-colors"
                  >
                    {rk.keyword}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
