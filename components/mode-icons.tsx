import type { ReactNode } from "react";
import { Building2, Store, Tent, User } from "lucide-react";

export type ModeIconName = "personal" | "regular" | "booth" | "org";

export function modeAccentTextClass(mode: ModeIconName): string {
  switch (mode) {
    case "personal":
      return "text-rz-rose";
    case "booth":
      return "text-rz-amber";
    case "org":
      return "text-rz-purple";
    default:
      return "text-rz-green";
  }
}

export function renderModeIcon(
  mode: ModeIconName,
  size = 28,
  className = "",
): ReactNode {
  const classes = `${modeAccentTextClass(mode)} ${className}`.trim();
  switch (mode) {
    case "personal":
      return <User size={size} className={classes} aria-hidden />;
    case "booth":
      return <Tent size={size} className={classes} aria-hidden />;
    case "org":
      return <Building2 size={size} className={classes} aria-hidden />;
    default:
      return <Store size={size} className={classes} aria-hidden />;
  }
}
