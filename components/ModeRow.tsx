import type { ReactNode } from "react";

export function ModeRow({
  icon,
  label,
  sublabel,
  selected,
  disabled,
  onClick,
  action,
}: {
  icon: ReactNode;
  label: string;
  sublabel?: string;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  action?: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`tap-target flex min-h-12 w-full items-center gap-3 px-3 py-3 text-left text-sm font-medium disabled:opacity-40 ${
          selected ? "text-rz-text" : "text-rz-text active:bg-rz-elevated"
        }`}
      >
        <span className="flex h-7 w-7 items-center justify-center" aria-hidden>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{label}</span>
          {sublabel && (
            <span className="block truncate text-xs font-normal text-rz-hint">{sublabel}</span>
          )}
        </span>
        {action ?? (selected ? <span className="shrink-0 text-rz-muted">✓</span> : null)}
      </button>
    </li>
  );
}
