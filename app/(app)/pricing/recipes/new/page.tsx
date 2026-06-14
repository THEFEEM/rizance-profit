"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { apiFetch } from "@/lib/api-client";
import { PricingBack } from "@/components/pricing/PricingBack";
import { PRICING_LABELS, type MenuItem } from "@/types/pricing";

export default function NewRecipePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setSaving(true);
    setError(null);
    const res = await apiFetch<MenuItem>("/api/menu-items", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      router.push(`/pricing/recipes/${res.data.id}`);
      router.refresh();
    } else {
      setError(res.message);
      setSaving(false);
    }
  }

  return (
    <div className="px-4 pb-8">
      <PricingBack href="/pricing/recipes" />
      <h1 className="pt-1 text-lg font-medium text-rz-text">เพิ่ม{PRICING_LABELS.menu}</h1>
      <div className="mt-4 flex flex-col gap-4">
        <Input
          label={PRICING_LABELS.menu}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ลาเต้"
        />
        {error && (
          <p className="text-sm text-rz-red" role="alert">
            {error}
          </p>
        )}
        <Button onClick={create} disabled={saving || !name.trim()}>
          {saving ? "กำลังสร้าง…" : "ถัดไป — ใส่สูตร"}
        </Button>
      </div>
    </div>
  );
}
