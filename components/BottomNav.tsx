"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { key: "today", label: "Today", icon: "🏠" },
  { key: "income", label: "+In", icon: "➕" },
  { key: "expense", label: "−Out", icon: "➖" },
  { key: "stats", label: "Stats", icon: "📊" },
] as const;

function isNavActive(pathname: string, key: string, href: string): boolean {
  if (key === "today") return pathname === href;
  if (key === "stats" && href === "/summary") return pathname.startsWith("/summary");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav({
  mode,
  todayHref,
  incomeHref,
  expenseHref,
  statsHref,
}: {
  mode: "regular" | "booth" | "project";
  todayHref: string;
  incomeHref: string;
  expenseHref: string;
  statsHref: string;
}) {
  const pathname = usePathname();
  const accentActive =
    mode === "booth"
      ? "text-rz-amber"
      : mode === "project"
        ? "text-rz-purple"
        : "text-rz-green";
  const accentIdle = "text-rz-hint";

  const hrefByKey: Record<string, string> = {
    today: todayHref,
    income: incomeHref,
    expense: expenseHref,
    stats: statsHref,
  };

  return (
    <nav className="sticky bottom-0 z-10 border-t-[0.5px] border-rz-border bg-rz-nav">
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)]">
        {NAV_ITEMS.map((item) => {
          const href = hrefByKey[item.key];
          const active = isNavActive(pathname, item.key, href);
          return (
            <Link
              key={item.key}
              href={href}
              className={`tap-target no-select flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium ${
                active ? accentActive : accentIdle
              }`}
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
