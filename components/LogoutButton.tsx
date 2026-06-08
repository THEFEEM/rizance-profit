"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      onClick={logout}
      disabled={busy}
      className="tap-target no-select rounded-xl px-3 text-sm font-medium text-slate-500 active:bg-slate-100 disabled:opacity-50"
    >
      {busy ? "…" : "Log out"}
    </button>
  );
}
