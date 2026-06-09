"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { PRICING_LABELS, type MenuItem } from "@/types/pricing";

export function RecipeList({ items }: { items: MenuItem[] }) {
  const router = useRouter();

  async function remove(id: string) {
    if (!window.confirm("ลบเมนูนี้?")) return;
    await fetch(`/api/menu-items/${id}`, { method: "DELETE" });
    router.refresh();
  }

  if (items.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-slate-400">ยังไม่มีเมนู — กดเพิ่มด้านล่าง</p>;
  }

  return (
    <ul className="divide-y divide-slate-100">
      {items.map((m) => (
        <li key={m.id} className="flex items-center gap-3 px-4 py-3">
          <Link href={`/pricing/recipes/${m.id}`} className="min-w-0 flex-1">
            <p className="font-medium text-slate-900">{m.name}</p>
            <p className="text-sm text-emerald-700">
              {PRICING_LABELS.ingredientCost}: {formatMoney(m.ingredientCostPerCup)}/แก้ว
            </p>
          </Link>
          <button onClick={() => remove(m.id)} className="tap-target text-slate-400" aria-label="ลบ">
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
