"use client";

import { useRouter } from "next/navigation";

export function UpgradePrompt({
  message = "AI credits หมดแล้ว — อัพเกรดเพื่อใช้ต่อ",
  onUpgrade,
}: {
  message?: string;
  onUpgrade?: () => void;
}) {
  const router = useRouter();

  function handleUpgrade() {
    if (onUpgrade) {
      onUpgrade();
      return;
    }
    router.push("/pricing");
  }

  return (
    <div className="rounded-[14px] border border-amber-500/30 bg-amber-500/10 px-4 py-4">
      <p className="text-sm font-medium text-rz-text">{message}</p>
      <button
        type="button"
        onClick={handleUpgrade}
        className="tap-target mt-4 min-h-10 rounded-[12px] bg-rz-green px-4 text-sm font-medium text-rz-bg"
      >
        อัพเกรด
      </button>
    </div>
  );
}
