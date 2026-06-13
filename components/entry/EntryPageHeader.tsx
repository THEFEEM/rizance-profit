"use client";

import { useRouter } from "next/navigation";

export function EntryPageHeader({
  title,
  backLabel = "← Cancel",
}: {
  title: string;
  backLabel?: string;
}) {
  const router = useRouter();

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <button
        type="button"
        onClick={() => router.back()}
        className="tap-target text-sm font-medium text-rz-hint active:text-rz-muted"
      >
        {backLabel}
      </button>
      <h1 className="text-base font-medium text-rz-text">{title}</h1>
      <span className="w-16" aria-hidden />
    </div>
  );
}
