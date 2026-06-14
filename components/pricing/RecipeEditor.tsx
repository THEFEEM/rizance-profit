"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { apiFetch } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { computeCostPerUnit, computeRecipeLineCost, sumLineCosts } from "@/lib/pricing-math";
import { isSuspiciousRecipeQuantity, recipeUsageUnitLabel } from "@/lib/pricing-units";
import {
  PRICING_LABELS,
  type Ingredient,
  type MenuItem,
  type RecipeLine,
} from "@/types/pricing";

type DraftLine = { ingredientId: string; quantity: string };

const SELECT_CLASS =
  "tap-target w-full rounded-[11px] border-[0.5px] border-rz-border bg-rz-card px-3 py-2.5 text-sm text-rz-text outline-none focus:border-rz-green";

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
  const pickedIngredient = pickIngredient ? ingMap.get(pickIngredient) : undefined;
  const usageUnitLabel = pickedIngredient
    ? recipeUsageUnitLabel(pickedIngredient.purchaseUnit)
    : null;
  const qtySuspicious =
    pickedIngredient !== undefined &&
    qtyRaw !== "" &&
    isSuspiciousRecipeQuantity(qtyRaw, pickedIngredient.purchaseUnit);

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

      <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card p-4">
        <p className="text-sm font-medium text-rz-text">เพิ่มวัตถุดิบในสูตร</p>
        {ingredients.length === 0 ? (
          <p className="mt-2 text-sm text-rz-hint">เพิ่มวัตถุดิบก่อนที่ ต้นทุนวัตถุดิบ</p>
        ) : (
          <>
            <select
              value={pickIngredient}
              onChange={(e) => setPickIngredient(e.target.value)}
              className={`${SELECT_CLASS} mt-2`}
            >
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <p className="mt-3 text-xs text-rz-muted">{PRICING_LABELS.quantityUsed}</p>
            <div className="mt-1 flex items-center gap-3">
              <p className="rz-tabular min-w-0 flex-1 text-3xl font-medium text-rz-text">
                {formatTyped(qtyRaw) || "0"}
              </p>
              {usageUnitLabel && (
                <span className="shrink-0 rounded-[11px] border-[0.5px] border-rz-logo-border bg-rz-logo-bg px-4 py-2 text-xl font-medium text-rz-green">
                  {usageUnitLabel}
                </span>
              )}
            </div>
            {qtySuspicious && (
              <p
                className="mt-2 rounded-[11px] border-[0.5px] border-rz-amber/30 bg-rz-amber/10 px-3 py-2 text-sm leading-snug text-rz-amber"
                role="status"
              >
                ปริมาณน้อยผิดปกติ — กรอกเป็น มล./กรัม ใช่ไหม?
              </p>
            )}
            <QuickAmountPad value={qtyRaw} onChange={setQtyRaw} onSave={addLine} saveLabel="เพิ่มในสูตร" />
          </>
        )}
      </div>

      {previewLines.length > 0 && (
        <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b-[0.5px] border-rz-border text-xs text-rz-hint">
                <th className="px-3 py-2 font-medium">{PRICING_LABELS.menu}</th>
                <th className="px-2 py-2 font-medium">{PRICING_LABELS.quantityUsed}</th>
                <th className="px-2 py-2 font-medium">{PRICING_LABELS.costPerUnit}</th>
                <th className="px-2 py-2 font-medium">{PRICING_LABELS.lineCost}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {previewLines.map((l) => (
                <tr key={l.name} className="border-b-[0.5px] border-rz-border last:border-b-0">
                  <td className="px-3 py-2 text-rz-text">{l.name}</td>
                  <td className="rz-tabular px-2 py-2 text-rz-muted">
                    {l.quantity} {l.unitLabel}
                  </td>
                  <td className="rz-tabular px-2 py-2 text-rz-muted">{formatMoney(l.costPerUnit)}</td>
                  <td className="rz-tabular px-2 py-2 font-medium text-rz-green">
                    {formatMoney(l.lineCost)}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        const ing = ingredients.find((i) => i.name === l.name);
                        if (ing) removeLine(ing.id);
                      }}
                      className="tap-target flex h-8 w-8 items-center justify-center rounded-full text-rz-hint active:bg-rz-elevated"
                      aria-label="ลบ"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="rz-tabular border-t-[0.5px] border-rz-border px-4 py-3 text-right text-sm font-medium text-rz-green">
            รวมต้นทุนวัตถุดิบ/แก้ว: {formatMoney(totalCost)}
          </p>
        </div>
      )}

      {error && (
        <p className="text-sm text-rz-red" role="alert">
          {error}
        </p>
      )}
      <Button onClick={save} disabled={saving || lines.length === 0}>
        {saving ? "กำลังบันทึก…" : "บันทึกสูตร"}
      </Button>
    </div>
  );
}
