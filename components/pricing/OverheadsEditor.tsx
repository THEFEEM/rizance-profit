"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { apiFetch } from "@/lib/api-client";
import {
  OVERHEAD_CATEGORY_LABELS,
  PRICING_LABELS,
  type Overhead,
  type PricingSettings,
} from "@/types/pricing";

export function OverheadsEditor({
  items: initialItems,
  settings: initialSettings,
  monthlyTotal,
}: {
  items: Overhead[];
  settings: PricingSettings;
  monthlyTotal: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [cups, setCups] = useState(String(initialSettings.estimatedCupsPerMonth));
  const [defaultProfit, setDefaultProfit] = useState(initialSettings.defaultProfitPerCup ?? "");
  const [newOtherLabel, setNewOtherLabel] = useState("");
  const [newOtherAmount, setNewOtherAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setAmount(id: string, amount: string) {
    setItems((prev) => prev.map((o) => (o.id === id ? { ...o, monthlyAmount: amount } : o)));
  }

  async function save() {
    setSaving(true);
    setError(null);

    const settingsRes = await apiFetch<PricingSettings>("/api/pricing/settings", {
      method: "PATCH",
      body: JSON.stringify({
        estimatedCupsPerMonth: Number(cups) || 0,
        defaultProfitPerCup: defaultProfit === "" ? null : Number(defaultProfit),
      }),
    });
    if (!settingsRes.ok) {
      setError(settingsRes.message);
      setSaving(false);
      return;
    }

    for (const item of items) {
      const res = await apiFetch<Overhead>(`/api/overheads/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ monthlyAmount: Number(item.monthlyAmount) }),
      });
      if (!res.ok) {
        setError(res.message);
        setSaving(false);
        return;
      }
    }

    router.refresh();
    setSaving(false);
  }

  async function addOther() {
    if (!newOtherAmount) return;
    setError(null);
    const res = await apiFetch<Overhead>("/api/overheads", {
      method: "POST",
      body: JSON.stringify({
        category: "other",
        label: newOtherLabel.trim() || undefined,
        monthlyAmount: Number(newOtherAmount),
      }),
    });
    if (res.ok) {
      setItems((prev) => [...prev, res.data]);
      setNewOtherLabel("");
      setNewOtherAmount("");
      router.refresh();
    } else {
      setError(res.message);
    }
  }

  async function removeOther(id: string) {
    if (!window.confirm("ลบรายการนี้?")) return;
    const res = await fetch(`/api/overheads/${id}`, { method: "DELETE" });
    if (res.ok) {
      setItems((prev) => prev.filter((o) => o.id !== id));
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-8">
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700">การตั้งค่า</h2>
        <div className="mt-3 flex flex-col gap-3">
          <Input
            label={PRICING_LABELS.cupsPerMonth}
            type="number"
            inputMode="numeric"
            min={0}
            value={cups}
            onChange={(e) => setCups(e.target.value)}
          />
          <Input
            label={PRICING_LABELS.defaultProfit}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={defaultProfit}
            onChange={(e) => setDefaultProfit(e.target.value)}
            placeholder="เช่น 15"
          />
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700">{PRICING_LABELS.overheads}</h2>
        <p className="mt-1 text-xs text-slate-500">
          รวมต่อเดือน: ฿{Number(monthlyTotal).toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </p>
        <ul className="mt-4 divide-y divide-slate-100">
          {items.map((o) => (
            <li key={o.id} className="flex items-center gap-2 py-3">
              <span className="min-w-0 flex-1 text-sm text-slate-800">
                {o.category === "other"
                  ? o.label || OVERHEAD_CATEGORY_LABELS.other
                  : OVERHEAD_CATEGORY_LABELS[o.category]}
              </span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={o.monthlyAmount}
                onChange={(e) => setAmount(o.id, e.target.value)}
                className="tap-target w-28 rounded-xl border border-slate-300 px-2 py-2 text-right text-sm tabular-nums"
              />
              {o.category === "other" && (
                <button
                  type="button"
                  onClick={() => removeOther(o.id)}
                  className="tap-target text-slate-400"
                  aria-label="ลบ"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="text-sm font-medium text-slate-700">เพิ่ม{OVERHEAD_CATEGORY_LABELS.other}</p>
          <div className="mt-2 flex flex-col gap-2">
            <Input
              placeholder="ชื่อรายการ (ไม่บังคับ)"
              value={newOtherLabel}
              onChange={(e) => setNewOtherLabel(e.target.value)}
            />
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder="จำนวนเงิน"
              value={newOtherAmount}
              onChange={(e) => setNewOtherAmount(e.target.value)}
            />
            <Button variant="secondary" onClick={addOther} disabled={!newOtherAmount}>
              + เพิ่มรายการ
            </Button>
          </div>
        </div>
      </section>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <Button onClick={save} disabled={saving}>
        {saving ? "กำลังบันทึก…" : "บันทึกทั้งหมด"}
      </Button>
    </div>
  );
}
