"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Home, LayoutGrid, Plus, Settings, Sparkles } from "lucide-react";
import { ModePicker } from "@/components/ModePicker";

const NAV_ICON_SIZE = 22;
const FAB_ICON_SIZE = 24;
const ICON_STROKE = 2;

const CHAT_HREF = "/chat";
const PERSONAL_CHAT_HREF = "/personal/chat";

const BASE_NAV_ITEMS = [
  { key: "today", label: "หน้าหลัก", Icon: Home, kind: "link" as const },
  { key: "stats", label: "สถิติ", Icon: BarChart3, kind: "link" as const },
  { key: "entry", label: "+", Icon: Plus, kind: "link" as const, prominent: true },
  { key: "profile", label: "ตั้งค่า", Icon: Settings, kind: "link" as const },
] as const;

function fourthNavItem(
  mode: "regular" | "booth" | "project" | "personal",
  boothId?: string,
) {
  if (mode === "regular") {
    return {
      key: "ai",
      label: "Rizq",
      Icon: Sparkles,
      kind: "link" as const,
      href: CHAT_HREF,
    };
  }
  if (mode === "personal") {
    return {
      key: "ai",
      label: "Rizq",
      Icon: Sparkles,
      kind: "link" as const,
      href: PERSONAL_CHAT_HREF,
    };
  }
  if (mode === "booth" && boothId) {
    return {
      key: "ai",
      label: "Rizq",
      Icon: Sparkles,
      kind: "link" as const,
      href: `/booth/${boothId}/chat`,
    };
  }
  return {
    key: "mode",
    label: "โหมด",
    Icon: LayoutGrid,
    kind: "action" as const,
  };
}

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
    if (
      pathname === CHAT_HREF ||
      pathname.startsWith(`${CHAT_HREF}/`) ||
      pathname === PERSONAL_CHAT_HREF ||
      pathname.startsWith(`${PERSONAL_CHAT_HREF}/`) ||
      /^\/booth\/[^/]+\/chat\/?$/.test(pathname)
    ) {
      return false;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  if (key === "ai") {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  if (key === "profile") {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  return false;
}

function accentClasses(mode: "regular" | "booth" | "project" | "personal", active: boolean) {
  if (!active) return "text-rz-hint";
  if (mode === "personal") return "text-rz-rose";
  if (mode === "booth") return "text-rz-amber";
  if (mode === "project") return "text-rz-purple";
  return "text-rz-green";
}

export function BottomNav({
  mode,
  shopName,
  boothId,
  boothName,
  projectId,
  projectName,
  orgName,
  todayHref,
  entryHref,
  statsHref,
  profileHref,
}: {
  mode: "regular" | "booth" | "project" | "personal";
  shopName: string;
  boothId?: string;
  boothName?: string;
  projectId?: string;
  projectName?: string;
  orgName?: string | null;
  todayHref: string;
  entryHref: string;
  statsHref: string;
  profileHref: string;
}) {
  const pathname = usePathname();
  const [pickerOpen, setPickerOpen] = useState(false);

  const hrefByKey: Record<string, string> = {
    today: todayHref,
    entry: entryHref,
    stats: statsHref,
    profile: profileHref,
    ai:
      mode === "personal"
        ? PERSONAL_CHAT_HREF
        : mode === "booth" && boothId
          ? `/booth/${boothId}/chat`
          : CHAT_HREF,
  };

  const navItems = [
    ...BASE_NAV_ITEMS.slice(0, 3),
    fourthNavItem(mode, boothId),
    ...BASE_NAV_ITEMS.slice(3),
  ];

  return (
    <>
      <nav className="sticky bottom-0 z-10 border-t-[0.5px] border-rz-border bg-rz-nav">
        <div className="mx-auto flex max-w-md items-end justify-around px-1 pb-[env(safe-area-inset-bottom)] pt-1">
          {navItems.map((item) => {
            if (item.kind === "action") {
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-label="เลือกโหมด"
                  aria-expanded={pickerOpen}
                  onClick={() => setPickerOpen(true)}
                  className={`tap-target no-select flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium ${
                    pickerOpen ? accentClasses(mode, true) : "text-rz-hint"
                  }`}
                >
                  <item.Icon
                    size={NAV_ICON_SIZE}
                    strokeWidth={ICON_STROKE}
                    aria-hidden
                  />
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
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-rz-green text-rz-bg shadow-md ring-2 ring-rz-green/40"
                    aria-hidden
                  >
                    <item.Icon size={FAB_ICON_SIZE} strokeWidth={ICON_STROKE} />
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
                <item.Icon size={NAV_ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <ModePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        mode={mode}
        shopName={shopName}
        boothId={boothId}
        boothName={boothName}
        projectId={projectId}
        projectName={projectName}
        orgName={orgName}
      />
    </>
  );
}
