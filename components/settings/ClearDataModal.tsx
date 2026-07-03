"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type { AppContextMode } from "@/types/context";

type ResetScope = "personal" | "shop" | "booth" | "org";

function appModeToResetScope(mode: AppContextMode): ResetScope {
  if (mode === "regular") return "shop";
  if (mode === "project") return "org";
  return mode;
}

const RESET_COPY: Record<
  ResetScope,
  { title: string; paragraphs: string[] }
> = {
  personal: {
    title: "รีเซ็ตข้อมูลส่วนตัว",
    paragraphs: [
      "ระบบจะลบธุรกรรมส่วนตัวทั้งหมดของคุณ (ไม่กระทบร้านค้า/บูธ/องค์กร)",
      "สิทธิ์การใช้งาน (แพ็กเกจ) จะยังคงอยู่ ไม่หาย",
      "การกระทำนี้ไม่สามารถกู้คืนได้",
    ],
  },
  shop: {
    title: "รีเซ็ตข้อมูลร้านค้านี้",
    paragraphs: [
      "ระบบจะลบทุกอย่างของร้านค้านี้เท่านั้น — ธุรกรรม หุ้นส่วน และชื่อร้าน",
      "บูธ องค์กร และโหมดส่วนตัวของคุณจะไม่ถูกแตะต้อง",
      "สิทธิ์การใช้งาน (แพ็กเกจ) จะยังคงอยู่ ไม่หาย",
      "การกระทำนี้ไม่สามารถกู้คืนได้",
    ],
  },
  booth: {
    title: "รีเซ็ตข้อมูลบูธนี้",
    paragraphs: [
      "ระบบจะลบทุกอย่างของบูธนี้เท่านั้น — ธุรกรรม สมาชิก และตัวบูธ",
      "บูธอื่น ร้านค้า และองค์กรของคุณจะไม่ถูกแตะต้อง",
      "สิทธิ์การใช้งาน (แพ็กเกจ) จะยังคงอยู่ ไม่หาย",
      "การกระทำนี้ไม่สามารถกู้คืนได้",
    ],
  },
  org: {
    title: "รีเซ็ตข้อมูลองค์กรนี้",
    paragraphs: [
      "ระบบจะลบทุกอย่างขององค์กรนี้เท่านั้น — ธุรกรรม สมาชิก และตัวองค์กร",
      "องค์กรอื่น ร้านค้า และบูธของคุณจะไม่ถูกแตะต้อง",
      "สิทธิ์การใช้งาน (แพ็กเกจ) จะยังคงอยู่ ไม่หาย",
      "การกระทำนี้ไม่สามารถกู้คืนได้",
    ],
  },
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
  const router = useRouter();
  const resetScope = appModeToResetScope(mode);
  const copy = RESET_COPY[resetScope];
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

  const canSubmit = input === "ยืนยัน" && !loading;

  async function handleSubmit() {
    if (!canSubmit) return;

    setLoading(true);
    setError(null);
    const res = await apiFetch<{ ok: true; redirect?: string }>("/api/settings/clear-all-data", {
      method: "POST",
      body: JSON.stringify({ mode: resetScope }),
    });
    setLoading(false);

    if (!res.ok) {
      setError(res.message);
      return;
    }

    onSuccess();
    if (res.data.redirect) {
      router.replace(res.data.redirect);
    }
    router.refresh();
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

        <h2 className="text-base font-semibold text-rz-text">{copy.title}</h2>
        {copy.paragraphs.map((paragraph) => (
          <p key={paragraph} className="mt-2 text-sm leading-6 text-rz-muted">
            {paragraph}
          </p>
        ))}

        <div className="mt-4">
          <label htmlFor="clear-data-confirm" className="mb-2 block text-sm text-rz-hint">
            พิมพ์ &quot;ยืนยัน&quot; เพื่อยืนยัน
          </label>
          <input
            id="clear-data-confirm"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ยืนยัน"
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
            {loading ? "กำลังรีเซ็ต..." : "รีเซ็ตทั้งหมด"}
          </button>
        </div>
      </div>
    </div>
  );
}
