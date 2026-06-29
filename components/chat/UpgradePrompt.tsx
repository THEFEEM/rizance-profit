"use client";

import { useRouter } from "next/navigation";

export function UpgradePrompt({
  feature,
  limit,
  used,
  onUpgrade,
}: {
  feature: string;
  limit: number;
  used: number;
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
      <p className="text-sm font-medium text-rz-text">ถึงขีดจำกัด {feature}</p>
      <p className="mt-1 text-sm text-rz-muted">
        ใช้ไป {used} / {limit} ครั้งในรอบนี้แล้ว
      </p>
      <p className="mt-2 text-sm text-rz-muted">
        อัพเกรดแพ็กเกจเพื่อใช้งานต่อได้เต็มรูปแบบ
      </p>
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
