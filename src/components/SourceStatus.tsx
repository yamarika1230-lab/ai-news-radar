"use client";

import dayjs from "dayjs";
import type { SourceStatus as SourceStatusType } from "@/lib/types";

interface SourceStatusProps {
  statuses: SourceStatusType[];
  selectedSource: string | null;
  onSourceChange: (source: string | null) => void;
}

export default function SourceStatus({
  statuses,
  selectedSource,
  onSourceChange,
}: SourceStatusProps) {
  if (statuses.length === 0) {
    return (
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#A0A09C]">
          ソースステータス
        </h3>
        <p className="text-xs text-[#A0A09C]">データ未取得</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#A0A09C]">
        ソースステータス
      </h3>
      <div className="space-y-1">
        {statuses.map((s) => (
          <button
            key={s.name}
            type="button"
            onClick={() =>
              onSourceChange(selectedSource === s.name ? null : s.name)
            }
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 transition-colors"
            style={{
              backgroundColor:
                selectedSource === s.name ? "#F0EEFF" : "white",
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  s.status === "ok"
                    ? "bg-[#2EAE8E]"
                    : s.status === "warn"
                      ? "bg-[#D4A030]"
                      : "bg-[#E07050]"
                }`}
              />
              <span
                className="text-sm"
                style={{
                  color: selectedSource === s.name ? "#7C6FE0" : "#2D2D2D",
                  fontWeight: selectedSource === s.name ? 600 : 400,
                }}
              >
                {s.name}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[#A0A09C]">
              <span>{s.count}件</span>
              {s.lastRun && (
                <span>{dayjs(s.lastRun).format("HH:mm")}</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
