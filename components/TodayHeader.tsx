import { HeaderSettings } from "@/components/HeaderSettings";

function displayInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }
  return (name.trim().slice(0, 2) || "?").toUpperCase();
}

export function TodayHeader({
  displayName,
  dateLabel,
  mode,
}: {
  displayName: string;
  dateLabel: string;
  mode: "regular" | "booth" | "project";
}) {
  const ringColor =
    mode === "booth"
      ? "ring-rz-amber"
      : mode === "project"
        ? "ring-rz-purple"
        : "ring-rz-green";

  return (
    <header className="flex items-center justify-between px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rz-elevated text-sm font-medium text-rz-text ring-2 ${ringColor}`}
          aria-hidden
        >
          {displayInitials(displayName)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-rz-text">{displayName}</p>
          <p className="text-[11px] text-rz-hint">{dateLabel}</p>
        </div>
      </div>
      <HeaderSettings />
    </header>
  );
}
