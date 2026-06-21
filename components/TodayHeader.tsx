import { UserAvatar } from "@/components/UserAvatar";

export function TodayHeader({
  displayName,
  avatarUrl,
  dateLabel,
  mode,
}: {
  displayName: string;
  avatarUrl?: string | null;
  dateLabel: string;
  mode: "regular" | "booth" | "project" | "personal";
}) {
  const ringColor =
    mode === "personal"
      ? "ring-rz-rose"
      : mode === "booth"
        ? "ring-rz-amber"
        : mode === "project"
          ? "ring-rz-purple"
          : "ring-rz-green";

  return (
    <header className="flex items-center justify-between px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <UserAvatar name={displayName} avatarUrl={avatarUrl} size="sm" ringClassName={ringColor} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-rz-text">{displayName}</p>
          <p className="text-[11px] text-rz-hint">{dateLabel}</p>
        </div>
      </div>
    </header>
  );
}
