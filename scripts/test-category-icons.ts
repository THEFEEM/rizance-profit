/**
 * PHASE 4.3 — CATEGORY ICON SYSTEM CHECK
 *
 * พิสูจน์ว่า icon ของหมวดทุกตัวมาจากแหล่งเดียว (Lucide ใน lib/category-lucide-icons.tsx)
 * ไม่มี emoji เหลือในชั้น presentation ของหมวด · CategoryGrid ยังคง a11y เดิม
 *
 * render จริงด้วย react-dom/server แล้วตรวจ output — ไม่ใช่ส่องซอร์สอย่างเดียว
 *
 * รัน: npm run test:category-icons
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LucideIcon } from "lucide-react";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const head = (t: string) => console.log(`\n== ${t} ${"=".repeat(Math.max(0, 56 - t.length))}`);
const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** emoji/pictograph จริง — ไม่นับ ✕ … ✓ ✎ ⋯ ที่เป็นสัญลักษณ์ UI ทั่วไป */
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const html = (n: ReactNode) => renderToStaticMarkup(createElement("div", null, n));

async function main(): Promise<void> {
  const icons = await import("../lib/category-lucide-icons");
  const shop = await import("../lib/expense-categories");
  const personal = await import("../lib/personal-categories");
  const types = await import("../types");
  const lucide = await import("lucide-react");

  // ══ 1–4 · ทุก key มี mapping (ไม่ตก fallback) ════════════════════════
  head("1 · SHOP INCOME — ทุก key มี Lucide");
  const shopIncomeFallback = html(icons.renderShopIncomeIcon("__unknown__"));
  for (const k of shop.INCOME_CATEGORY_KEYS) {
    const out = html(icons.renderShopIncomeIcon(k));
    check(`1.x ${k}`, out.includes("<svg") && (k === "storefront" || out !== shopIncomeFallback));
  }

  head("2 · SHOP EXPENSE — ทุก key มี Lucide");
  const shopExpenseFallback = html(icons.renderShopExpenseIcon("__unknown__"));
  for (const k of shop.EXPENSE_CATEGORY_KEYS) {
    const out = html(icons.renderShopExpenseIcon(k));
    check(`2.x ${k}`, out.includes("<svg") && (k === "expense_misc" || out !== shopExpenseFallback));
  }

  head("3 · PERSONAL INCOME — ทุก key มี Lucide");
  const pIncFallback = html(icons.renderPersonalIncomeIcon("__unknown__"));
  for (const k of personal.PERSONAL_INCOME_KEYS) {
    const out = html(icons.renderPersonalIncomeIcon(k));
    check(`3.x ${k}`, out.includes("<svg") && (k === "salary" || out !== pIncFallback));
  }

  head("4 · PERSONAL EXPENSE — ทุก key มี Lucide");
  const pExpFallback = html(icons.renderPersonalExpenseIcon("__unknown__"));
  for (const k of personal.PERSONAL_EXPENSE_KEYS) {
    const out = html(icons.renderPersonalExpenseIcon(k));
    check(`4.x ${k}`, out.includes("<svg") && (k === "other_expense" || out !== pExpFallback));
  }

  // ══ 5 · legacy aliases ═══════════════════════════════════════════════
  head("5 · LEGACY ALIASES");
  const legacyInc = icons.LEGACY_SHOP_INCOME_GRID_OPTIONS;
  const legacyExp = icons.LEGACY_SHOP_EXPENSE_GRID_OPTIONS;
  check("5.1 legacy income options ครบ 3", legacyInc.length === 3);
  check("5.2 legacy expense options ครบ 6", legacyExp.length === 6);
  check("5.3 legacy 'other' (income) → icon เดียวกับ other_income",
    html(legacyInc.find((o) => o.value === "other")!.icon) === html(icons.renderShopIncomeIcon("other_income", 22)));
  check("5.4 legacy 'supplies' → icon เดียวกับ materials",
    html(legacyExp.find((o) => o.value === "supplies")!.icon) === html(icons.renderShopExpenseIcon("materials", 22)));
  check("5.5 legacy 'salary' → icon เดียวกับ wage",
    html(legacyExp.find((o) => o.value === "salary")!.icon) === html(icons.renderShopExpenseIcon("wage", 22)));
  check("5.6 legacy 'other' (expense) → icon เดียวกับ expense_misc",
    html(legacyExp.find((o) => o.value === "other")!.icon) === html(icons.renderShopExpenseIcon("expense_misc", 22)));
  check("5.7 ทุก legacy option render เป็น svg", [...legacyInc, ...legacyExp].every((o) => html(o.icon).includes("<svg")));

  // ══ 6 · output เป็น React/SVG ═══════════════════════════════════════
  head("6 · RENDER OUTPUT");
  const sample = icons.renderShopExpenseIcon("materials", 24);
  check("6.1 render*Icon คืน React element", isValidElement(sample));
  const sampleHtml = html(sample);
  check("6.2 …เป็น <svg", sampleHtml.includes("<svg"));
  check("6.3 …aria-hidden (decorative)", sampleHtml.includes('aria-hidden="true"'));
  check("6.4 …ขนาดตามที่ขอ", sampleHtml.includes('width="24"') && sampleHtml.includes('height="24"'));
  check("6.5 …stroke-based (outline) ไม่ใช่ fill", sampleHtml.includes('stroke="currentColor"') && sampleHtml.includes('fill="none"'));
  check("6.6 renderEntryKindIcon(voided) = Ban", html(icons.renderEntryKindIcon("voided")) === html(createElement(lucide.Ban, { size: 20, strokeWidth: 2, "aria-hidden": true })));
  check("6.7 renderEntryKindIcon(transfer) = ArrowLeftRight", html(icons.renderEntryKindIcon("transfer")) === html(createElement(lucide.ArrowLeftRight, { size: 20, strokeWidth: 2, "aria-hidden": true })));

  // ══ 7 · ไม่มี emoji ในชั้น presentation ของหมวด ════════════════════
  head("7 · NO EMOJI IN CATEGORY PRESENTATION");
  const allGrid = [
    ...icons.SHOP_INCOME_GRID_OPTIONS, ...icons.SHOP_EXPENSE_GRID_OPTIONS,
    ...icons.PERSONAL_INCOME_GRID_OPTIONS, ...icons.PERSONAL_EXPENSE_GRID_OPTIONS,
    ...legacyInc, ...legacyExp,
  ];
  check("7.1 ไม่มี grid option ใดที่ icon เป็น string", allGrid.every((o) => typeof o.icon !== "string"));
  check("7.2 ไม่มี grid option ใดที่ render ออกมาแล้วมี emoji", allGrid.every((o) => !EMOJI_RE.test(html(o.icon))));
  for (const f of ["lib/expense-categories.ts", "lib/personal-categories.ts", "lib/project-stats.ts"]) {
    check(`7.3 ${f} ไม่มี emoji เหลือ`, !EMOJI_RE.test(src(f)));
  }
  for (const f of [
    "components/EntryList.tsx", "components/booth/BoothEntryList.tsx", "components/BoothDayEntryList.tsx",
    "components/project/summary/ProjectOverviewView.tsx", "components/project/summary/ProjectActivitySummaryView.tsx",
    "components/chat/ChatEntryCard.tsx", "components/CategoryGrid.tsx",
  ]) {
    check(`7.4 ${f} ไม่มี emoji`, !EMOJI_RE.test(src(f)));
  }
  check("7.5 unknown key → fallback ก็ยังเป็น svg ไม่ใช่ emoji",
    ["__x__"].every((k) =>
      [icons.renderShopIncomeIcon(k), icons.renderShopExpenseIcon(k), icons.renderPersonalIncomeIcon(k), icons.renderPersonalExpenseIcon(k)]
        .every((n) => html(n).includes("<svg") && !EMOJI_RE.test(html(n)))));

  // ══ 8 · duplicate emoji GRID_OPTIONS / helpers หายไปแล้ว ═══════════
  head("8 · SINGLE SOURCE OF TRUTH");
  const shopMod = shop as unknown as Record<string, unknown>;
  const personalMod = personal as unknown as Record<string, unknown>;
  for (const name of ["INCOME_CATEGORY_GRID_OPTIONS", "EXPENSE_CATEGORY_GRID_OPTIONS", "incomeCategoryIcon", "expenseCategoryIcon"]) {
    check(`8.1 expense-categories ไม่ export ${name}`, !(name in shopMod));
  }
  for (const name of ["PERSONAL_INCOME_GRID_OPTIONS", "PERSONAL_EXPENSE_GRID_OPTIONS", "PERSONAL_INCOME_ICONS", "PERSONAL_EXPENSE_ICONS", "personalIncomeIcon", "personalExpenseIcon"]) {
    check(`8.2 personal-categories ไม่ export ${name}`, !(name in personalMod));
  }
  const projStats = (await import("../lib/project-stats")) as unknown as Record<string, unknown>;
  check("8.3 project-stats ไม่ export projectFundingEmoji/projectExpenseEmoji",
    !("projectFundingEmoji" in projStats) && !("projectExpenseEmoji" in projStats));
  check("8.4 category def ไม่มี field icon แล้ว",
    shop.INCOME_CATEGORIES.every((c) => !("icon" in c)) && shop.EXPENSE_CATEGORIES.every((c) => !("icon" in c)));
  check("8.5 @/types INCOME_CATEGORY_GRID_OPTIONS === Lucide SHOP_INCOME_GRID_OPTIONS (alias เดียวกัน)",
    types.INCOME_CATEGORY_GRID_OPTIONS === icons.SHOP_INCOME_GRID_OPTIONS);
  check("8.6 @/types EXPENSE_CATEGORY_GRID_OPTIONS === Lucide SHOP_EXPENSE_GRID_OPTIONS",
    types.EXPENSE_CATEGORY_GRID_OPTIONS === icons.SHOP_EXPENSE_GRID_OPTIONS);
  check("8.7 ChatEntryCard import personal grid จาก category-lucide-icons",
    /PERSONAL_(INCOME|EXPENSE)_GRID_OPTIONS[\s\S]*?from "@\/lib\/category-lucide-icons"/.test(src("components/chat/ChatEntryCard.tsx")));
  check("8.8 grid options ยังครบทุก key (ไม่มีหมวดหาย)",
    icons.SHOP_INCOME_GRID_OPTIONS.length === shop.INCOME_CATEGORY_KEYS.length &&
    icons.SHOP_EXPENSE_GRID_OPTIONS.length === shop.EXPENSE_CATEGORY_KEYS.length &&
    icons.PERSONAL_INCOME_GRID_OPTIONS.length === personal.PERSONAL_INCOME_KEYS.length &&
    icons.PERSONAL_EXPENSE_GRID_OPTIONS.length === personal.PERSONAL_EXPENSE_KEYS.length);
  check("8.9 label ในกริดตรงกับ label ต้นทาง (ไม่ได้ rename หมวด)",
    icons.SHOP_EXPENSE_GRID_OPTIONS.every((o) => o.label === shop.expenseCategoryLabel(o.value)) &&
    icons.SHOP_INCOME_GRID_OPTIONS.every((o) => o.label === shop.incomeCategoryLabel(o.value)) &&
    icons.PERSONAL_EXPENSE_GRID_OPTIONS.every((o) => o.label === personal.personalExpenseLabel(o.value)));

  // ══ 9 · CategoryGrid a11y ════════════════════════════════════════════
  head("9 · CATEGORY GRID");
  const { CategoryGrid } = await import("../components/CategoryGrid");
  const grid = renderToStaticMarkup(
    createElement(CategoryGrid, {
      options: icons.SHOP_EXPENSE_GRID_OPTIONS,
      value: "materials",
      onChange: () => {},
      columns: 2,
    }),
  );
  check("9.1 role=radiogroup", grid.includes('role="radiogroup"'));
  const buttons = grid.match(/<button[^>]*>/g) ?? [];
  check("9.2 button ครบเท่าจำนวน option", buttons.length === icons.SHOP_EXPENSE_GRID_OPTIONS.length, String(buttons.length));
  check("9.3 ทุก button type=button", buttons.every((b) => b.includes('type="button"')));
  check("9.4 ทุก button role=radio", buttons.every((b) => b.includes('role="radio"')));
  check("9.5 aria-checked true ตัวเดียว", (grid.match(/aria-checked="true"/g) ?? []).length === 1);
  check("9.6 ตัวที่เลือกใช้ token mint/navy เดิม", /aria-checked="true"[^>]*bg-rz-green text-rz-bg/.test(grid));
  check("9.7 touch target ≥ 44px (min-h-12 = 48px)", buttons.every((b) => b.includes("min-h-12")));
  check("9.8 touch-manipulation + select-none", buttons.every((b) => b.includes("touch-manipulation") && b.includes("select-none")));
  check("9.9 label รองรับ 2 บรรทัด + ไม่ล้น (line-clamp-2 · break-words · min-w-0)",
    grid.includes("line-clamp-2") && grid.includes("break-words") && buttons.every((b) => b.includes("min-w-0")));
  check("9.10 ไม่มี <img> (icon ต้องเป็น svg inline)", !grid.includes("<img") && grid.includes("<svg"));
  check("9.11 ไม่มี emoji ใน markup ทั้งกริด", !EMOJI_RE.test(grid));
  const gridSrc = src("components/CategoryGrid.tsx");
  check("9.12 ไม่มี logic ความกว้าง viewport ใน JS", !/window\.(innerWidth|matchMedia)|useWindow|useMediaQuery/.test(gridSrc));

  // ══ 10 · approved mappings เป๊ะ ══════════════════════════════════════
  head("10 · APPROVED MAPPINGS");
  const same = (n: ReactNode, Icon: LucideIcon, size = 20) =>
    html(n) === html(createElement(Icon, { size, strokeWidth: 2, "aria-hidden": true }));
  check("10.1 shop income online = ShoppingCart", same(icons.renderShopIncomeIcon("online"), lucide.ShoppingCart));
  check("10.2 shop expense rent = Building2", same(icons.renderShopExpenseIcon("rent"), lucide.Building2));
  check("10.3 personal expense rent = Building2", same(icons.renderPersonalExpenseIcon("rent"), lucide.Building2));
  check("10.4 storefront ยัง Store (ไม่กระทบ)", same(icons.renderShopIncomeIcon("storefront"), lucide.Store));
  check("10.5 materials ยัง Package (ไม่กระทบ)", same(icons.renderShopExpenseIcon("materials"), lucide.Package));
  check("10.6 online ≠ materials (เลิกซ้ำ Package)", html(icons.renderShopIncomeIcon("online")) !== html(icons.renderShopExpenseIcon("materials")));
  check("10.7 rent ≠ storefront (เลิกซ้ำ Store)", html(icons.renderShopExpenseIcon("rent")) !== html(icons.renderShopIncomeIcon("storefront")));

  head("SUMMARY");
  console.log(`PASS ${pass} · FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("\n🛑 harness error:", e); process.exit(3); });
