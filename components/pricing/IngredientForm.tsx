"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { apiFetch } from "@/lib/api-client";
import { computeCostPerUnit } from "@/lib/pricing-math";
import { formatMoney } from "@/lib/money";
import { PRICING_LABELS, PURCHASE_UNITS, type Ingredient, type PurchaseUnit } from "@/types/pricing";

const UNIT_LABELS: Record<PurchaseUnit, string> = {
  ml: "มล.",
  g: "กรัม",
  kg: "กก.",
  l: "ลิตร",
  piece: "ชิ้น",
  shot: "ช็อต",
  pump: "ปั๊ม",
};

export function IngredientForm({ initial }: { initial?: Ingredient }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [qtyRaw, setQtyRaw] = useState(initial?.purchaseQuantity ?? "");
  const [unit, setUnit] = useState<PurchaseUnit>(initial?.purchaseUnit ?? "ml");
  const [priceRaw, setPriceRaw] = useState(initial?.purchasePrice ?? "");
  const [padTarget, setPadTarget] = useState<"qty" | "price">("price");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewCost = useMemo(() => {
    if (!qtyRaw || !priceRaw || Number(qtyRaw) <= 0) return null;
    return computeCostPerUnit(priceRaw, qtyRaw);
  }, [qtyRaw, priceRaw]);

  const padValue = padTarget === "qty" ? qtyRaw : priceRaw;
  const setPadValue = padTarget === "qty" ? setQtyRaw : setPriceRaw;

  async function save() {
    setSaving(true);
    setError(null);
    const body = {
      name,
      purchaseQuantity: Number(qtyRaw),
      purchaseUnit: unit,
      purchasePrice: Number(priceRaw),
    };
    const res = initial
      ? await apiFetch<Ingredient>(`/api/ingredients/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        })
      : await apiFetch<Ingredient>("/api/ingredients", { method: "POST", body: JSON.stringify(body) });
    if (res.ok) {
      router.push("/pricing/ingredients");
      router.refresh();
    } else {
      setError(res.message);
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      <Input
        label={PRICING_LABELS.ingredientName}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="นมสด"
      />

      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-700">{PRICING_LABELS.purchaseSize}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPadTarget("qty")}
            className={`tap-target flex-1 rounded-xl border px-3 py-2 text-left text-lg font-bold tabular-nums ${
              padTarget === "qty" ? "border-emerald-500 bg-emerald-50" : "border-slate-300"
            }`}
          >
            {formatTyped(qtyRaw) || "0"} {UNIT_LABELS[unit]}
          </button>
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as PurchaseUnit)}
            className="tap-target rounded-xl border border-slate-300 px-2 text-sm"
          >
            {PURCHASE_UNITS.map((u) => (
              <option key={u} value={u}>{UNIT_LABELS[u]}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-700">{PRICING_LABELS.purchasePrice}</p>
        <button
          type="button"
          onClick={() => setPadTarget("price")}
          className={`tap-target w-full rounded-xl border px-3 py-2 text-left text-2xl font-bold tabular-nums ${
            padTarget === "price" ? "border-emerald-500 bg-emerald-50" : "border-slate-300"
          }`}
        >
          ฿ {formatTyped(priceRaw) || "0"}
        </button>
      </div>

      {previewCost && (
        <p className="text-center text-sm text-slate-600">
          {PRICING_LABELS.costPerUnit}:{" "}
          <span className="font-bold text-emerald-700">
            {formatMoney(previewCost)} / {UNIT_LABELS[unit]}
          </span>
        </p>
      )}

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      <QuickAmountPad
        value={padValue}
        onChange={setPadValue}
        onSave={save}
        saving={saving}
        saveLabel="บันทึก"
      />
    </div>
  );
}
