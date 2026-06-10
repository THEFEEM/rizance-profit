"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type { Booth } from "@/types/booth";
import type { AppContext } from "@/types/context";

export function ModeSwitcher({
  mode,
  boothId,
  boothName,
}: {
  mode: "regular" | "booth";
  boothId?: string;
  boothName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [booths, setBooths] = useState<Booth[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = mode === "regular" ? "ร้านประจำ" : (boothName ?? "งานบูธ");

  async function openSheet() {
    setOpen(true);
    setError(null);
    if (booths !== null) return;
    setLoading(true);
    const res = await apiFetch<Booth[]>("/api/booths");
    setLoading(false);
    if (res.ok) {
      setBooths(res.data);
    } else {
      setError(res.message);
      setBooths([]);
    }
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
      setOpen(false);
      router.refresh();
    } else {
      setError(res.message);
    }
  }

  return (
    <>
      <div className="px-4 pt-3">
        <button
          type="button"
          onClick={openSheet}
          className="tap-target flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm active:bg-slate-50"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <span className="text-sm font-semibold text-slate-900">{label}</span>
          <span className="text-slate-400" aria-hidden>
            ▾
          </span>
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mode-switcher-title"
          onClick={() => !switching && setOpen(false)}
        >
          <div
            className="max-h-[80dvh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="mode-switcher-title" className="text-lg font-bold text-slate-900">
              สลับโหมด
            </h2>
            <p className="mt-1 text-sm text-slate-500">เลือกร้านประจำหรืองานบูธ</p>

            {error && (
              <p className="mt-3 text-sm text-red-600" role="alert">
                {error}
              </p>
            )}

            <ul className="mt-4 divide-y divide-slate-100">
              <li>
                <button
                  type="button"
                  disabled={switching}
                  onClick={() => selectContext({ mode: "regular" })}
                  className={`tap-target w-full px-2 py-3 text-left text-sm font-medium ${
                    mode === "regular" ? "text-emerald-700" : "text-slate-700"
                  } disabled:opacity-50`}
                >
                  ร้านประจำ {mode === "regular" && "✓"}
                </button>
              </li>

              {loading && (
                <li className="px-2 py-3 text-sm text-slate-400">กำลังโหลดงานบูธ…</li>
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
                        isActive ? "text-emerald-700" : "text-slate-700"
                      }`}
                    >
                      {b.name}
                      {b.status === "closed" && (
                        <span className="ml-1 text-xs text-slate-400">(ปิดแล้ว)</span>
                      )}
                      {isActive && " ✓"}
                    </button>
                  </li>
                );
              })}
            </ul>

            <Link
              href="/booth/new"
              onClick={() => setOpen(false)}
              className="tap-target mt-4 flex w-full items-center justify-center rounded-2xl border border-dashed border-slate-300 py-3 text-sm font-semibold text-slate-600 active:bg-slate-50"
            >
              + สร้างงานบูธ
            </Link>

            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={switching}
              className="tap-target mt-3 w-full py-2 text-sm font-medium text-slate-500"
            >
              ปิด
            </button>
          </div>
        </div>
      )}
    </>
  );
}
