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
    return (
      <p className="px-4 py-10 text-center text-sm text-rz-hint">ยังไม่มีเมนู — กดเพิ่มด้านล่าง</p>
    );
  }

  return (
    <ul className="divide-y divide-rz-border">
      {items.map((m) => (
        <li key={m.id} className="flex items-center gap-3 px-4 py-3.5">
          <Link href={`/pricing/recipes/${m.id}`} className="min-w-0 flex-1 active:opacity-90">
            <p className="font-medium text-rz-text">{m.name}</p>
            <p className="rz-tabular text-sm font-medium text-rz-green">
              {PRICING_LABELS.ingredientCost}: {formatMoney(m.ingredientCostPerCup)}/แก้ว
            </p>
          </Link>
          <button
            onClick={() => remove(m.id)}
            className="tap-target -mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-rz-hint active:bg-rz-elevated"
            aria-label="ลบ"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
