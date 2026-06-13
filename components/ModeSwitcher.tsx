"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type { Booth } from "@/types/booth";
import type { AppContext } from "@/types/context";

import { formatDayShort } from "@/lib/date";

function formatBoothDateRange(start: string, end: string): string {
  if (start === end) return formatDayShort(start);
  return `${formatDayShort(start)} – ${formatDayShort(end)}`;
}

function TentIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <path
        d="M4 20h16M6 20 12 4l6 16M9 14h6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ModeSwitcher({
  mode,
  boothId,
  boothName,
  boothStartDate,
  boothEndDate,
}: {
  mode: "regular" | "booth";
  boothId?: string;
  boothName?: string;
  boothStartDate?: string;
  boothEndDate?: string;
}) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [booths, setBooths] = useState<Booth[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadBooths(): Promise<Booth[]> {
    if (booths !== null) return booths;
    setLoading(true);
    const res = await apiFetch<Booth[]>("/api/booths");
    setLoading(false);
    if (res.ok) {
      setBooths(res.data);
      return res.data;
    }
    setError(res.message);
    setBooths([]);
    return [];
  }

  async function selectContext(body: { mode: "regular" } | { mode: "booth"; boothId: string }) {
    setSwitching(true);
    setError(null);
    const res = await apiFetch<AppContext>("/api/context", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    setSwitching(false);
    if (res.ok) {
      setPickerOpen(false);
      router.refresh();
    } else {
      setError(res.message);
    }
  }

  async function switchToRegular() {
    if (mode === "regular" || switching) return;
    await selectContext({ mode: "regular" });
  }

  async function switchToBooth() {
    if (switching) return;
    if (mode === "booth") {
      setPickerOpen(true);
      setError(null);
      await loadBooths();
      return;
    }

    const list = await loadBooths();
    const open = list.filter((b) => b.status === "open");
    if (open.length === 1) {
      await selectContext({ mode: "booth", boothId: open[0].id });
      return;
    }
    setPickerOpen(true);
  }

  return (
    <>
      <div className="px-4 pt-1">
        <div
          className="flex rounded-full bg-rz-elevated p-[3px]"
          role="tablist"
          aria-label="สลับโหมด"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "regular"}
            disabled={switching}
            onClick={switchToRegular}
            className={`tap-target flex-1 rounded-full py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
              mode === "regular"
                ? "bg-rz-green text-rz-bg"
                : "text-rz-muted active:bg-rz-card"
            }`}
          >
            ร้านค้า
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "booth"}
            disabled={switching}
            onClick={switchToBooth}
            className={`tap-target flex-1 rounded-full py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
              mode === "booth"
                ? "bg-rz-amber text-rz-bg"
                : "text-rz-muted active:bg-rz-card"
            }`}
          >
            บูธ
          </button>
        </div>
        {mode === "booth" && boothName && (
          <p className="mt-2 flex items-center justify-center gap-1.5 truncate text-center text-[11px] font-medium text-rz-amber">
            <TentIcon />
            <span className="truncate">
              {boothName}
              {boothStartDate && boothEndDate && (
                <span className="text-rz-amber/80">
                  {" "}
                  · {formatBoothDateRange(boothStartDate, boothEndDate)}
                </span>
              )}
            </span>
          </p>
        )}
      </div>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="booth-picker-title"
          onClick={() => !switching && setPickerOpen(false)}
        >
          <div
            className="max-h-[80dvh] w-full max-w-sm overflow-y-auto rounded-2xl border-[0.5px] border-rz-border bg-rz-card p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="booth-picker-title" className="text-lg font-medium text-rz-text">
              เลือกงานบูธ
            </h2>
            <p className="mt-1 text-sm text-rz-muted">เลือกงานบูธที่เปิดอยู่</p>

            {error && (
              <p className="mt-3 text-sm text-rz-red" role="alert">
                {error}
              </p>
            )}

            <ul className="mt-4 divide-y divide-rz-border">
              {loading && (
                <li className="px-2 py-3 text-sm text-rz-hint">กำลังโหลดงานบูธ…</li>
              )}

              {booths?.map((b) => {
                const isActive = mode === "booth" && boothId === b.id;
                const disabled = b.status !== "open" || switching;
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => selectContext({ mode: "booth", boothId: b.id })}
                      className={`tap-target w-full px-2 py-3 text-left text-sm font-medium disabled:opacity-40 ${
                        isActive ? "text-rz-amber" : "text-rz-text"
                      }`}
                    >
                      {b.name}
                      {b.status === "closed" && (
                        <span className="ml-1 text-xs text-rz-hint">(ปิดแล้ว)</span>
                      )}
                      {isActive && " ✓"}
                    </button>
                  </li>
                );
              })}

              {!loading && booths?.every((b) => b.status !== "open") && (
                <li className="px-2 py-3 text-sm text-rz-hint">ยังไม่มีงานบูธที่เปิดอยู่</li>
              )}
            </ul>

            <Link
              href="/booth/new"
              onClick={() => setPickerOpen(false)}
              className="tap-target mt-4 flex w-full items-center justify-center rounded-2xl border border-dashed border-rz-border py-3 text-sm font-medium text-rz-muted active:bg-rz-elevated"
            >
              + สร้างงานบูธ
            </Link>

            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              disabled={switching}
              className="tap-target mt-3 w-full py-2 text-sm font-medium text-rz-hint"
            >
              ปิด
            </button>
          </div>
        </div>
      )}
    </>
  );
}
