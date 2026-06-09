import Link from "next/link";
import { PRICING_LABELS } from "@/types/pricing";

const SECTIONS = [
  { href: "/pricing/ingredients", title: PRICING_LABELS.ingredients, icon: "🥛" },
  { href: "/pricing/recipes", title: PRICING_LABELS.recipes, icon: "☕" },
  { href: "/pricing/overheads", title: PRICING_LABELS.overheads, icon: "🏪" },
  { href: "/pricing/calculate", title: PRICING_LABELS.calculate, icon: "💰" },
] as const;

export function PricingHub() {
  return (
    <div className="px-4 py-6">
      <h1 className="text-xl font-bold text-slate-900">{PRICING_LABELS.module}</h1>
      <p className="mt-1 text-sm text-slate-500">วางแผนต้นทุนและราคาขาย — ไม่กระทบหน้า Today</p>
      <div className="mt-6 grid gap-3">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="tap-target flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm active:bg-slate-50"
          >
            <span className="text-2xl" aria-hidden>{s.icon}</span>
            <span className="text-base font-semibold text-slate-900">{s.title}</span>
            <span className="ml-auto text-slate-400">→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
