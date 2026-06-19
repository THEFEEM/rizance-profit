"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { key: "today", label: "หน้าหลัก", icon: "🏠", kind: "link" as const },
  { key: "stats", label: "สถิติ", icon: "📊", kind: "link" as const },
  { key: "entry", label: "+", icon: "➕", kind: "link" as const, prominent: true },
  { key: "mode", label: "โหมด", icon: "🔀", kind: "action" as const },
  { key: "profile", label: "ฉัน", icon: "👤", kind: "link" as const },
] as const;

function isNavActive(
  pathname: string,
  key: string,
  href: string,
  statsHref: string,
): boolean {
  if (key === "today") return pathname === href;
  if (key === "stats") {
    if (statsHref === "/summary") return pathname.startsWith("/summary");
    return pathname === statsHref || pathname.startsWith(`${statsHref}/`);
  }
  if (key === "entry") {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  if (key === "profile") {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  return false;
}

function accentClasses(mode: "regular" | "booth" | "project", active: boolean) {
  if (!active) return "text-rz-hint";
  if (mode === "booth") return "text-rz-amber";
  if (mode === "project") return "text-rz-purple";
  return "text-rz-green";
}

function entryFabClasses(mode: "regular" | "booth" | "project") {
  if (mode === "booth") return "bg-rz-amber text-rz-bg ring-rz-amber/40";
  if (mode === "project") return "bg-rz-purple text-rz-bg ring-rz-purple/40";
  return "bg-rz-green text-rz-bg ring-rz-green/40";
}

export function BottomNav({
  mode,
  todayHref,
  entryHref,
  statsHref,
  profileHref,
}: {
  mode: "regular" | "booth" | "project";
  todayHref: string;
  entryHref: string;
  statsHref: string;
  profileHref: string;
}) {
  const pathname = usePathname();

  const hrefByKey: Record<string, string> = {
    today: todayHref,
    entry: entryHref,
    stats: statsHref,
    profile: profileHref,
  };

  return (
    <nav className="sticky bottom-0 z-10 border-t-[0.5px] border-rz-border bg-rz-nav">
      <div className="mx-auto flex max-w-md items-end justify-around px-1 pb-[env(safe-area-inset-bottom)] pt-1">
        {NAV_ITEMS.map((item) => {
          if (item.kind === "action") {
            return (
              <button
                key={item.key}
                type="button"
                aria-label="โหมด (เร็วๆ นี้)"
                className="tap-target no-select flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-rz-hint"
              >
                <span className="text-xl leading-none" aria-hidden>
                  {item.icon}
                </span>
                {item.label}
              </button>
            );
          }

          const href = hrefByKey[item.key];
          const active = isNavActive(pathname, item.key, href, statsHref);
          const accent = accentClasses(mode, active);

          if (item.key === "entry") {
            return (
              <Link
                key={item.key}
                href={href}
                aria-label="บันทึกรายการ"
                className={`tap-target no-select -mt-3 flex flex-1 flex-col items-center justify-end gap-0.5 pb-2 text-[10px] font-medium ${accent}`}
              >
                <span
                  className={`flex h-12 w-12 items-center justify-center rounded-full text-2xl leading-none shadow-md ring-2 ${entryFabClasses(mode)}`}
                  aria-hidden
                >
                  {item.icon}
                </span>
                <span className="sr-only">{item.label}</span>
              </Link>
            );
          }

          return (
            <Link
              key={item.key}
              href={href}
              className={`tap-target no-select flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium ${accent}`}
            >
              <span className="text-xl leading-none" aria-hidden>
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
