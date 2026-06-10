"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { key: "today", href: "/", label: "Today", icon: "🏠" },
  { key: "income", label: "+In", icon: "➕" },
  { key: "expense", label: "−Out", icon: "➖" },
  { key: "stats", href: "/summary", label: "Stats", icon: "📊" },
] as const;

function isNavActive(pathname: string, key: string, href: string): boolean {
  if (key === "today") return pathname === "/";
  if (key === "stats") return pathname.startsWith("/summary");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav({
  incomeHref,
  expenseHref,
}: {
  incomeHref: string;
  expenseHref: string;
}) {
  const pathname = usePathname();

  const hrefByKey: Record<string, string> = {
    today: "/",
    income: incomeHref,
    expense: expenseHref,
    stats: "/summary",
  };

  return (
    <nav className="sticky bottom-0 z-10 border-t border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)]">
        {NAV_ITEMS.map((item) => {
          const href = hrefByKey[item.key];
          const active = isNavActive(pathname, item.key, href);
          return (
            <Link
              key={item.key}
              href={href}
              className={`tap-target no-select flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium ${
                active ? "text-emerald-700" : "text-slate-500"
              }`}
            >
              <span className="text-lg leading-none" aria-hidden>
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
