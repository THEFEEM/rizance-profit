"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M19.4 13.5a7.4 7.4 0 0 0 .1-3l2-1.2-2-3.5-2.3.7a7.6 7.6 0 0 0-2.6-1.5l-.4-2.4H9.8l-.4 2.4a7.6 7.6 0 0 0-2.6 1.5l-2.3-.7-2 3.5 2 1.2a7.4 7.4 0 0 0-.1 3l-2 1.2 2 3.5 2.3-.7c.8.6 1.7 1.1 2.6 1.5l.4 2.4h4.4l.4-2.4c.9-.4 1.8-.9 2.6-1.5l2.3.7 2-3.5-2-1.2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HeaderSettings() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  async function logout() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="ตั้งค่าและบัญชี"
        aria-expanded={open}
        className="tap-target flex h-11 w-11 items-center justify-center rounded-full text-rz-hint active:bg-rz-elevated"
      >
        <GearIcon />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 min-w-[10rem] overflow-hidden rounded-xl border-[0.5px] border-rz-border bg-rz-card py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={logout}
            className="tap-target w-full px-4 py-2.5 text-left text-sm font-medium text-rz-muted active:bg-rz-elevated disabled:opacity-50"
          >
            {busy ? "กำลังออก…" : "ออกจากระบบ"}
          </button>
        </div>
      )}
    </div>
  );
}
