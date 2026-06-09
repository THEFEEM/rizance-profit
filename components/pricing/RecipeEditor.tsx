"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { apiFetch } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { computeCostPerUnit, computeRecipeLineCost, sumLineCosts } from "@/lib/pricing-math";
import { recipeUsageUnitLabel } from "@/lib/pricing-units";
import {
  PRICING_LABELS,
  type Ingredient,
  type MenuItem,
  type RecipeLine,
} from "@/types/pricing";

type DraftLine = { ingredientId: string; quantity: string };

export function RecipeEditor({
  menuItem,
  recipe,
  ingredients,
}: {
  menuItem: MenuItem;
  recipe: RecipeLine[];
  ingredients: Ingredient[];
}) {
  const router = useRouter();
  const [name, setName] = useState(menuItem.name);
  const [desiredProfit, setDesiredProfit] = useState(menuItem.desiredProfit ?? "");
  const [lines, setLines] = useState<DraftLine[]>(
    recipe.map((r) => ({ ingredientId: r.ingredientId, quantity: r.quantity })),
  );
  const [pickIngredient, setPickIngredient] = useState(ingredients[0]?.id ?? "");
  const [qtyRaw, setQtyRaw] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ingMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const previewLines = lines.map((l) => {
    const ing = ingMap.get(l.ingredientId);
    if (!ing) return null;
    const cpu = computeCostPerUnit(ing.purchasePrice, ing.purchaseQuantity);
    return {
      name: ing.name,
      unitLabel: recipeUsageUnitLabel(ing.purchaseUnit),
      quantity: l.quantity,
      costPerUnit: cpu,
      lineCost: computeRecipeLineCost(
        l.quantity,
        ing.purchasePrice,
        ing.purchaseQuantity,
        ing.purchaseUnit,
      ),
    };
  }).filter(Boolean) as {
    name: string;
    unitLabel: string;
    quantity: string;
    costPerUnit: string;
    lineCost: string;
  }[];

  const totalCost = sumLineCosts(...previewLines.map((l) => l.lineCost), 0);

  function addLine() {
    if (!pickIngredient || !qtyRaw || Number(qtyRaw) <= 0) return;
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.ingredientId === pickIngredient);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ingredientId: pickIngredient, quantity: qtyRaw };
        return next;
      }
      return [...prev, { ingredientId: pickIngredient, quantity: qtyRaw }];
    });
    setQtyRaw("");
  }

  function removeLine(ingredientId: string) {
    setLines((prev) => prev.filter((l) => l.ingredientId !== ingredientId));
  }

  async function save() {
    setSaving(true);
    setError(null);

    const metaRes = await apiFetch<MenuItem>(`/api/menu-items/${menuItem.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name,
        desiredProfit: desiredProfit === "" ? null : Number(desiredProfit),
      }),
    });
    if (!metaRes.ok) {
      setError(metaRes.message);
      setSaving(false);
      return;
    }

    const recipeRes = await apiFetch<RecipeLine[]>(`/api/menu-items/${menuItem.id}/recipe`, {
      method: "PUT",
      body: JSON.stringify({
        items: lines.map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity) })),
      }),
    });
    if (recipeRes.ok) {
      router.push("/pricing/recipes");
      router.refresh();
    } else {
      setError(recipeRes.message);
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      <Input label={PRICING_LABELS.menu} value={name} onChange={(e) => setName(e.target.value)} />
      <Input
        label={PRICING_LABELS.desiredProfit + " (ต่อแก้ว, ไม่บังคับ)"}
        type="number"
        min={0}
        step="0.01"
        value={desiredProfit}
        onChange={(e) => setDesiredProfit(e.target.value)}
        placeholder="ใช้ค่าเริ่มต้นจากค่าใช้จ่ายร้าน"
      />

      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-700">เพิ่มวัตถุดิบในสูตร</p>
        {ingredients.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">เพิ่มวัตถุดิบก่อนที่ ต้นทุนวัตถุดิบ</p>
        ) : (
          <>
            <select
              value={pickIngredient}
              onChange={(e) => setPickIngredient(e.target.value)}
              className="tap-target mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            >
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
            <p className="mt-2 text-sm text-slate-600">
              {PRICING_LABELS.quantityUsed}
              {pickIngredient && ingMap.has(pickIngredient) && (
                <span className="text-slate-400">
                  {" "}
                  ({recipeUsageUnitLabel(ingMap.get(pickIngredient)!.purchaseUnit)})
                </span>
              )}
            </p>
            <p className="text-2xl font-bold tabular-nums">{formatTyped(qtyRaw) || "0"}</p>
            <QuickAmountPad value={qtyRaw} onChange={setQtyRaw} onSave={addLine} saveLabel="เพิ่มในสูตร" />
          </>
        )}
      </div>

      {previewLines.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs text-slate-500">
                <th className="px-3 py-2">{PRICING_LABELS.menu}</th>
                <th className="px-2 py-2">{PRICING_LABELS.quantityUsed}</th>
                <th className="px-2 py-2">{PRICING_LABELS.costPerUnit}</th>
                <th className="px-2 py-2">{PRICING_LABELS.lineCost}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {previewLines.map((l) => (
                <tr key={l.name} className="border-b border-slate-50">
                  <td className="px-3 py-2">{l.name}</td>
                  <td className="px-2 py-2 tabular-nums">
                    {l.quantity} {l.unitLabel}
                  </td>
                  <td className="px-2 py-2 tabular-nums">{formatMoney(l.costPerUnit)}</td>
                  <td className="px-2 py-2 font-semibold tabular-nums text-emerald-700">
                    {formatMoney(l.lineCost)}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        const ing = ingredients.find((i) => i.name === l.name);
                        if (ing) removeLine(ing.id);
                      }}
                      className="text-slate-400"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-right text-sm font-bold text-emerald-700">
            รวมต้นทุนวัตถุดิบ/แก้ว: {formatMoney(totalCost)}
          </p>
        </div>
      )}

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <Button onClick={save} disabled={saving || lines.length === 0}>
        {saving ? "กำลังบันทึก…" : "บันทึกสูตร"}
      </Button>
    </div>
  );
}
