"use client";

import { Button } from "@/components/ui/Button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <p className="text-lg font-semibold text-slate-800">Something went wrong</p>
      <p className="text-sm text-slate-500">
        {error.message || "We couldn't load your data. Check your connection and try again."}
      </p>
      <Button onClick={reset} className="max-w-xs">
        Try again
      </Button>
    </div>
  );
}
