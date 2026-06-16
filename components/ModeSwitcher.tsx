"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type { Booth } from "@/types/booth";
import type { AppContext } from "@/types/context";
import {
  BuildingStoreIcon,
  ClipboardListIcon,
  TentIcon,
} from "@/components/project/icons";

import { formatDayShort } from "@/lib/date";

function formatBoothDateRange(start: string, end: string): string {
  if (start === end) return formatDayShort(start);
  return `${formatDayShort(start)} – ${formatDayShort(end)}`;
}

type SwitcherMode = "regular" | "booth" | "project";

export function ModeSwitcher({
  mode,
  boothId,
  boothName,
  boothStartDate,
  boothEndDate,
}: {
  mode: SwitcherMode;
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

  async function selectContext(
    body: { mode: "regular" } | { mode: "booth"; boothId: string },
    opts?: { leaveProject?: boolean },
  ) {
    setSwitching(true);
    setError(null);
    const res = await apiFetch<AppContext>("/api/context", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    setSwitching(false);
    if (res.ok) {
      setPickerOpen(false);
      if (opts?.leaveProject ?? mode === "project") router.push("/");
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
      setSwitching(true);
      setError(null);
      const res = await apiFetch<AppContext>("/api/context", {
        method: "PATCH",
        body: JSON.stringify({ mode: "booth", boothId: open[0].id }),
      });
      setSwitching(false);
      if (res.ok) {
        if (mode === "project") router.push("/");
        router.refresh();
      } else {
        setError(res.message);
      }
      return;
    }
    setPickerOpen(true);
  }

  function switchToProject() {
    if (mode === "project" || switching) return;
    router.push("/projects");
  }

  const openBooths = booths?.filter((b) => b.status === "open") ?? [];
  const closedCount = booths?.filter((b) => b.status === "closed").length ?? 0;

  const tabBase =
    "tap-target flex flex-1 items-center justify-center gap-1 rounded-full py-2 text-xs font-medium transition-colors disabled:opacity-50 sm:text-sm";

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
            className={`${tabBase} ${
              mode === "regular"
                ? "bg-rz-green text-rz-bg"
                : "text-rz-muted active:bg-rz-card"
            }`}
          >
            <BuildingStoreIcon size={14} />
            ร้านค้า
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "booth"}
            disabled={switching}
            onClick={switchToBooth}
            className={`${tabBase} ${
              mode === "booth"
                ? "bg-rz-amber text-rz-bg"
                : "text-rz-muted active:bg-rz-card"
            }`}
          >
            <TentIcon size={14} />
            บูธ
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "project"}
            disabled={switching}
            onClick={switchToProject}
            className={`${tabBase} ${
              mode === "project"
                ? "bg-rz-blue text-rz-bg"
                : "text-rz-muted active:bg-rz-card"
            }`}
          >
            <ClipboardListIcon size={14} />
            โครงการ
          </button>
        </div>
        {mode === "booth" && boothName && (
          <p className="mt-2 flex items-center justify-center gap-1.5 truncate text-center text-[11px] font-medium text-rz-amber">
            <TentIcon size={12} />
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
        {mode === "project" && (
          <p className="mt-2 flex items-center justify-center gap-1.5 truncate text-center text-[11px] font-medium text-rz-blue">
            <ClipboardListIcon size={12} />
            <span>โหมดโครงการ</span>
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
            className="flex max-h-[80dvh] w-full max-w-sm flex-col rounded-2xl border-[0.5px] border-rz-border bg-rz-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 p-4 pb-3">
              <h2 id="booth-picker-title" className="text-lg font-medium text-rz-text">
                เลือกงานบูธ
              </h2>
              <p className="mt-1 text-sm text-rz-muted">เลือกงานบูธที่เปิดอยู่</p>

              {error && (
                <p className="mt-3 text-sm text-rz-red" role="alert">
                  {error}
                </p>
              )}

              <Link
                href="/booth/new"
                onClick={() => setPickerOpen(false)}
                className="tap-target mt-4 flex min-h-11 w-full items-center justify-center rounded-[12px] border-[0.5px] border-[#5A3F12] bg-[#2E2310] text-sm font-medium text-rz-amber active:opacity-90"
              >
                ＋ สร้างงานบูธใหม่
              </Link>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4">
              <ul className="divide-y divide-rz-border border-t-[0.5px] border-rz-border">
                {loading && (
                  <li className="px-2 py-3 text-sm text-rz-hint">กำลังโหลดงานบูธ…</li>
                )}

                {!loading &&
                  openBooths.map((b) => {
                    const isActive = mode === "booth" && boothId === b.id;
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          disabled={switching}
                          onClick={() => selectContext({ mode: "booth", boothId: b.id })}
                          className={`tap-target min-h-11 w-full px-2 py-3 text-left text-sm font-medium disabled:opacity-40 ${
                            isActive ? "text-rz-amber" : "text-rz-text"
                          }`}
                        >
                          {b.name}
                          {isActive && " ✓"}
                        </button>
                      </li>
                    );
                  })}

                {!loading && booths !== null && openBooths.length === 0 && (
                  <li className="px-2 py-4 text-center text-sm text-rz-hint">
                    ยังไม่มีงานบูธที่เปิดอยู่
                  </li>
                )}
              </ul>
            </div>

            <div className="shrink-0 border-t-[0.5px] border-rz-border p-4 pt-3">
              {!loading && booths !== null && closedCount > 0 && (
                <Link
                  href="/booth"
                  onClick={() => setPickerOpen(false)}
                  className="tap-target mb-3 flex min-h-11 w-full items-center px-1 text-sm text-rz-hint active:text-rz-muted"
                >
                  ดูบูธที่ปิดแล้ว ({closedCount}) →
                </Link>
              )}

              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                disabled={switching}
                className="tap-target min-h-11 w-full py-2 text-sm font-medium text-rz-hint"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
