"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Download, Share } from "lucide-react";

/**
 * ปุ่มติดตั้งแอป (PWA) — ให้ผู้ใช้ติดตั้งลงเครื่องก่อน แล้วค่อยสมัครในแอป
 *
 * Android/Chrome/Edge : beforeinstallprompt → กดแล้วเด้ง install dialog ของระบบทันที
 * iOS/Safari          : ไม่มี API → เปิดชีตสอน "เพิ่มไปยังหน้าจอโฮม"
 * ติดตั้งอยู่แล้ว     : ปุ่มเปลี่ยนเป็น "เข้าใช้งาน" → /register
 * เดสก์ท็อปที่ทำไม่ได้: fallback ไป /register เหมือนเดิม (ไม่มีทางตัน)
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallAppButton({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) setInstalled(true);

    const ua = navigator.userAgent || "";
    setIsIOS(
      /iPad|iPhone|iPod/.test(ua) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    );

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setInstalled(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (deferred) {
        e.preventDefault();
        void deferred.prompt().then(() => setDeferred(null));
        return;
      }
      // ไม่มี prompt → สอนติดตั้งด้วยมือ
      e.preventDefault();
      setSheetOpen(true);
    },
    [deferred],
  );

  // ติดตั้งแล้ว → ไม่ต้องชวนซ้ำ พาเข้าใช้งานเลย
  if (installed) {
    return (
      <Link href="/register" className={className}>
        เข้าใช้งาน <ArrowRight size={15} />
      </Link>
    );
  }

  const steps = isIOS
    ? [
        "แตะปุ่ม แชร์ ด้านล่างจอ Safari",
        "เลื่อนหาแล้วแตะ เพิ่มไปยังหน้าจอโฮม",
        "แตะ เพิ่ม มุมขวาบน",
        "เปิด Rizance จากไอคอนบนหน้าจอโฮม",
      ]
    : [
        "เปิดเมนู ⋮ ของเบราว์เซอร์",
        "เลือก ติดตั้งแอป หรือ เพิ่มไปยังหน้าจอโฮม",
        "ยืนยันการติดตั้ง",
        "เปิด Rizance จากไอคอนที่ได้",
      ];

  return (
    <>
      <Link href="/register" className={className} onClick={handleClick}>
        <Download size={15} /> {label}
      </Link>

      {sheetOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSheetOpen(false);
          }}
          className="fixed inset-0 z-[999] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
        >
          <div className="w-full max-w-[460px] rounded-t-3xl border border-[var(--rz-border,#22304a)] bg-[var(--rz-card,#111a2b)] p-6 pb-8 text-left sm:rounded-3xl">
            <div className="flex items-start justify-between gap-3">
              <h3
                id="install-title"
                className="flex items-center gap-2 text-[19px] font-bold text-[var(--rz-text)]"
              >
                {isIOS ? <Share size={18} /> : <Download size={18} />}
                ติดตั้ง Rizance ลงเครื่อง
              </h3>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="ปิด"
                className="text-2xl leading-none text-[var(--rz-muted)]"
              >
                ×
              </button>
            </div>

            <ol className="mt-4 list-decimal space-y-2 pl-5 text-[15px] leading-relaxed text-[var(--rz-muted)]">
              {steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>

            <p className="mt-4 text-[13px] text-[var(--rz-muted)]">
              ติดตั้งแล้วเปิดจากไอคอนบนหน้าจอโฮม แล้วสมัครใช้งานในแอปได้เลย
            </p>

            <Link
              href="/register"
              className="mt-5 block rounded-xl bg-[var(--rz-green)] px-4 py-3.5 text-center font-bold text-[#06231a]"
            >
              ข้ามไปก่อน — ใช้บนเว็บ
            </Link>
          </div>
        </div>
      ) : null}
    </>
  );
}
