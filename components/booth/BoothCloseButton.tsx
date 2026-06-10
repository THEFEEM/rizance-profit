"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api-client";
import type { Booth } from "@/types/booth";

export function BoothCloseButton({ boothId }: { boothId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function closeBooth() {
    setClosing(true);
    setError(null);
    const res = await apiFetch<Booth>(`/api/booths/${boothId}/close`, { method: "POST" });
    if (res.ok) {
      setConfirming(false);
      router.refresh();
    } else {
      setError(res.message);
      setClosing(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="tap-target w-full rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 active:bg-red-100"
      >
        ปิดงานบูธ
      </button>

      {error && (
        <p className="mt-2 text-center text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-booth-title"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h2 id="close-booth-title" className="text-lg font-bold text-slate-900">
              ปิดงานบูธถาวร
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              ปิดงานบูธถาวร — แก้ไม่ได้อีก ยืนยัน?
            </p>
            <p className="mt-1 text-sm text-slate-500">
              หลังปิดแล้วจะเพิ่มรายรับ/รายจ่ายไม่ได้อีก
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Button variant="secondary" onClick={() => setConfirming(false)} disabled={closing}>
                ยกเลิก
              </Button>
              <Button variant="danger" onClick={closeBooth} disabled={closing}>
                {closing ? "กำลังปิด…" : "ยืนยันปิด"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
