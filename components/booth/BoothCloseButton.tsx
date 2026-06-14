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
        className="tap-target w-full rounded-[11px] border-[0.5px] border-rz-red/40 bg-rz-red/10 px-4 py-3 text-sm font-medium text-rz-red active:opacity-90"
      >
        ปิดงานบูธ
      </button>

      {error && (
        <p className="mt-2 text-center text-sm text-rz-red" role="alert">
          {error}
        </p>
      )}

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-booth-title"
        >
          <div className="w-full max-w-sm rounded-[14px] border-[0.5px] border-rz-border bg-rz-card p-5 shadow-xl">
            <h2 id="close-booth-title" className="text-lg font-medium text-rz-text">
              ปิดงานบูธถาวร
            </h2>
            <p className="mt-2 text-sm text-rz-amber">
              ปิดงานบูธถาวร — แก้ไม่ได้อีก ยืนยัน?
            </p>
            <p className="mt-1 text-sm text-rz-hint">
              หลังปิดแล้วจะเพิ่มรายรับ/รายจ่ายไม่ได้อีก
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Button variant="secondary" fullWidth onClick={() => setConfirming(false)} disabled={closing}>
                ยกเลิก
              </Button>
              <Button variant="danger" fullWidth onClick={closeBooth} disabled={closing}>
                {closing ? "กำลังปิด…" : "ยืนยันปิด"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
