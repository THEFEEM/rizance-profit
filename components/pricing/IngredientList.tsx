"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { PRICING_LABELS, type Ingredient } from "@/types/pricing";

const UNIT_LABELS: Record<string, string> = {
  ml: "มล.", g: "กรัม", kg: "กก.", l: "ลิตร", piece: "ชิ้น", shot: "ช็อต", pump: "ปั๊ม",
};

export function IngredientList({ items }: { items: Ingredient[] }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    if (deleting) return;
    if (!window.confirm("ลบวัตถุดิบนี้?")) return;
    setDeleting(id);
    setError(null);
    const res = await fetch(`/api/ingredients/${id}`, { method: "DELETE" });
    const body = await res.json().catch(() => null);
    if (res.ok) {
      router.refresh();
    } else if (res.status === 409 && body?.error?.menuItems) {
      const names = body.error.menuItems.map((m: { name: string }) => m.name).join(", ");
      setError(`ใช้ในสูตร: ${names} — ลบออกจากสูตรก่อน`);
    } else {
      setError(body?.error?.message ?? "ลบไม่สำเร็จ");
    }
    setDeleting(null);
  }

  if (items.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-rz-hint">
        ยังไม่มีวัตถุดิบ — กดเพิ่มด้านล่าง
      </p>
    );
  }

  return (
    <>
      {error && (
        <p className="px-4 py-2 text-sm text-rz-red" role="alert">
          {error}
        </p>
      )}
      <ul className="divide-y divide-rz-border">
        {items.map((ing) => (
          <li key={ing.id} className="flex items-center gap-3 px-4 py-3.5">
            <Link href={`/pricing/ingredients/${ing.id}`} className="min-w-0 flex-1 active:opacity-90">
              <p className="font-medium text-rz-text">{ing.name}</p>
              <p className="text-xs text-rz-hint">
                ซื้อ {ing.purchaseQuantity} {UNIT_LABELS[ing.purchaseUnit] ?? ing.purchaseUnit} @{" "}
                {formatMoney(ing.purchasePrice)}
              </p>
              <p className="rz-tabular text-sm font-medium text-rz-green">
                {PRICING_LABELS.costPerUnit} {formatMoney(ing.costPerUnit)}/
                {UNIT_LABELS[ing.purchaseUnit]}
              </p>
            </Link>
            <button
              onClick={() => remove(ing.id)}
              disabled={deleting === ing.id}
              className="tap-target -mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-rz-hint active:bg-rz-elevated disabled:opacity-40"
              aria-label="ลบ"
            >
              {deleting === ing.id ? "…" : "✕"}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
