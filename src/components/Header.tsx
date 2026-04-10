"use client";

import dayjs from "dayjs";

interface HeaderProps {
  lastUpdated: string | null;
  activeSourceCount: number;
  articleCount: number;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export default function Header({
  lastUpdated,
  activeSourceCount,
  articleCount,
  sidebarOpen,
  onToggleSidebar,
}: HeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-[#E8E8E4] bg-white px-4 py-3 sm:px-6">
      <div className="flex items-center gap-3">
        {/* ハンバーガー（モバイルのみ） */}
        <button
          type="button"
          onClick={onToggleSidebar}
          className="rounded-xl p-2 text-[#6B6B68] transition-colors hover:bg-[#F0F0EC] lg:hidden"
          aria-label={sidebarOpen ? "サイドバーを閉じる" : "サイドバーを開く"}
        >
          {sidebarOpen ? (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>

        {/* アプリ名 */}
        <div>
          <h1 className="text-lg font-bold text-[#2D2D2D]">AI News Radar</h1>
          {lastUpdated && (
            <p className="text-[11px] text-[#A0A09C]">
              最終更新: {dayjs(lastUpdated).format("YYYY/MM/DD HH:mm")}
            </p>
          )}
        </div>
      </div>

      {/* 右側バッジ */}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-xl bg-[#E6F8F3] px-3 py-1.5 text-xs font-medium text-[#2EAE8E]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2EAE8E]" />
          {activeSourceCount} ソース
        </span>
        <span className="inline-flex items-center rounded-xl bg-[#F0EEFF] px-3 py-1.5 text-xs font-medium text-[#7C6FE0]">
          {articleCount} 記事
        </span>
      </div>
    </header>
  );
}
