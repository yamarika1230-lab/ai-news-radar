"use client";

import dayjs from "dayjs";
import type { SourceStatus as SourceStatusType } from "@/lib/types";

interface SourceStatusProps {
  statuses: SourceStatusType[];
}

export default function SourceStatus({ statuses }: SourceStatusProps) {
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
      <div className="space-y-1.5">
        {statuses.map((s) => (
          <div
            key={s.name}
            className="flex items-center justify-between rounded-xl bg-white px-3 py-2"
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
              <span className="text-sm text-[#2D2D2D]">{s.name}</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[#A0A09C]">
              <span>{s.count}件</span>
              {s.lastRun && (
                <span>{dayjs(s.lastRun).format("HH:mm")}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
