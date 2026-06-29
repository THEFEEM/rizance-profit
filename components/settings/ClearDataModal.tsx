"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { AppContextMode } from "@/types/context";

const MODE_LABELS: Record<AppContextMode, string> = {
  regular: "ร้านค้า",
  personal: "ส่วนตัว",
  booth: "บูธ",
  project: "โครงการ",
};

export function ClearDataModal({
  open,
  mode,
  onClose,
  onSuccess,
}: {
  open: boolean;
  mode: AppContextMode;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setInput("");
      setLoading(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const canSubmit = input === "ลบ" && !loading;

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);

    const res = await apiFetch<{ ok: true; mode: AppContextMode }>("/api/settings/clear-mode-data", {
      method: "POST",
    });

    setLoading(false);

    if (res.ok) {
      onSuccess();
      return;
    }

    setError(res.message);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60">
      <button
        type="button"
        aria-label="ปิด"
        className="absolute inset-0 cursor-default"
        onClick={() => {
          if (!loading) onClose();
        }}
      />

      <div className="relative z-10 w-full rounded-t-[24px] border-t border-rz-border bg-rz-card px-4 pb-6 pt-4 shadow-2xl">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-rz-border" />

        <h2 className="text-base font-semibold text-rz-text">
          {`⚠️ ล้างข้อมูล ${MODE_LABELS[mode]}`}
        </h2>
        <p className="mt-2 text-sm leading-6 text-rz-muted">
          รายการธุรกรรม + ประวัติแชท จะถูกลบถาวร
        </p>

        <div className="mt-4">
          <label htmlFor="clear-data-confirm" className="mb-2 block text-sm text-rz-hint">
            พิมพ์ &quot;ลบ&quot; เพื่อยืนยัน
          </label>
          <input
            id="clear-data-confirm"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ลบ"
            disabled={loading}
            autoFocus
            className="w-full rounded-[14px] border border-[#F87171] bg-rz-elevated px-4 py-3 text-base text-rz-text outline-none placeholder:text-[#F87171]/50 focus:border-[#F87171]"
          />
          {error && (
            <p className="mt-2 text-sm text-[#F87171]" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="tap-target min-h-12 rounded-[14px] border border-rz-border bg-rz-elevated text-sm font-medium text-rz-text disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="tap-target min-h-12 rounded-[14px] text-sm font-medium text-white disabled:text-[#F87171]/50"
            style={{ backgroundColor: canSubmit ? "#F87171" : "rgb(248 113 113 / 0.2)" }}
          >
            {loading ? "กำลังลบ..." : "ลบข้อมูล"}
          </button>
        </div>
      </div>
    </div>
  );
}
