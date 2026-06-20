"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { EntryOptionButton } from "@/components/entry/EntryOptionButton";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { SetupField, SetupPrimaryButton } from "@/components/booth/setup/SetupField";
import { UserIcon } from "@/components/booth/setup/icons";
import { ROLE_STYLES } from "@/components/booth/summary/role-styles";
import { apiFetch } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import type { AppContext } from "@/types/context";
import type { User } from "@/types";
import {
  SHOP_MEMBER_ROLE_LABELS,
  SHOP_MEMBER_ROLES,
  type ShopMemberRole,
} from "@/types/shop";

type PendingMember = {
  tempId: string;
  name: string;
  role: ShopMemberRole;
  investmentAmount: number;
};

function RoleIconTile({ role }: { role: ShopMemberRole }) {
  const s = ROLE_STYLES[role];
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] ${s.badgeBg} ${s.badgeBorder} ${s.text}`}
    >
      <UserIcon />
    </span>
  );
}

/** Create/update shop name + optional partners — /shop/new */
export function CreateShopForm({
  initialShopName,
  currency = "THB",
}: {
  initialShopName: string;
  currency?: string;
}) {
  const router = useRouter();
  const [shopName, setShopName] = useState(initialShopName);
  const [pending, setPending] = useState<PendingMember[]>([]);
  const [name, setName] = useState("");
  const [role, setRole] = useState<ShopMemberRole>("investor");
  const [investmentRaw, setInvestmentRaw] = useState("");
  const [padOpen, setPadOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addPending() {
    if (!name.trim()) return;
    const amount = investmentRaw === "" ? 0 : Number(investmentRaw);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("กรุณาระบุเงินลงทุนที่ถูกต้อง");
      return;
    }
    setPending((prev) => [
      ...prev,
      {
        tempId: crypto.randomUUID(),
        name: name.trim(),
        role,
        investmentAmount: amount,
      },
    ]);
    setName("");
    setInvestmentRaw("");
    setPadOpen(false);
    setError(null);
  }

  function removePending(tempId: string) {
    setPending((prev) => prev.filter((m) => m.tempId !== tempId));
  }

  async function createShop() {
    const trimmed = shopName.trim();
    if (!trimmed) {
      setError("กรุณาระบุชื่อร้าน");
      return;
    }

    setSaving(true);
    setError(null);

    const nameRes = await apiFetch<{ user: User }>("/api/user", {
      method: "PATCH",
      body: JSON.stringify({ shopName: trimmed }),
    });
    if (!nameRes.ok) {
      setSaving(false);
      setError(nameRes.fields?.shopName?.[0] ?? nameRes.message);
      return;
    }

    for (const m of pending) {
      const memberRes = await apiFetch("/api/shop/members", {
        method: "POST",
        body: JSON.stringify({
          name: m.name,
          role: m.role,
          investmentAmount: m.investmentAmount,
        }),
      });
      if (!memberRes.ok) {
        setSaving(false);
        setError(memberRes.message);
        return;
      }
    }

    const ctxRes = await apiFetch<AppContext>("/api/context", {
      method: "PATCH",
      body: JSON.stringify({ mode: "regular" }),
    });
    setSaving(false);

    if (!ctxRes.ok) {
      setError(ctxRes.message);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <div className="space-y-6 px-4 pb-8 pt-4">
      <div>
        <h1 className="text-lg font-medium text-rz-text">สร้างร้านใหม่</h1>
        <p className="mt-1 text-sm text-rz-hint">ตั้งชื่อร้านและเพิ่มหุ้นส่วน (ถ้ามี)</p>
      </div>

      <SetupField
        label="ชื่อร้าน *"
        icon={<UserIcon />}
        value={shopName}
        onChange={(e) => setShopName(e.target.value)}
      />

      <section>
        <h2 className="mb-2 text-sm font-medium text-rz-muted">เพิ่มสมาชิก (หุ้นส่วน)</h2>
        <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card p-4">
          <div className="flex flex-wrap gap-2">
            {SHOP_MEMBER_ROLES.map((r) => (
              <EntryOptionButton
                key={r}
                selected={role === r}
                onClick={() => setRole(r)}
                accent={r === "manager" ? "amber" : "green"}
                className="text-xs"
              >
                {SHOP_MEMBER_ROLE_LABELS[r]}
              </EntryOptionButton>
            ))}
          </div>

          <div className="mt-3">
            <SetupField
              label="ชื่อสมาชิก"
              icon={<UserIcon />}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น น้องเอ"
            />
          </div>

          <div className="mt-3">
            <p className="text-xs text-rz-muted">เงินลงทุน</p>
            <p className="rz-tabular text-lg font-medium text-rz-text">
              {formatTyped(investmentRaw) || "0"}
            </p>
            {padOpen ? (
              <QuickAmountPad
                value={investmentRaw}
                onChange={setInvestmentRaw}
                onSave={() => setPadOpen(false)}
                saveLabel="ตกลง"
                accent="green"
              />
            ) : (
              <button
                type="button"
                onClick={() => setPadOpen(true)}
                className="tap-target text-sm font-medium text-rz-green"
              >
                ใส่จำนวน →
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={addPending}
            disabled={!name.trim()}
            className="tap-target mt-4 w-full rounded-[12px] border-[0.5px] border-dashed border-rz-border py-2.5 text-sm font-medium text-rz-green disabled:opacity-40"
          >
            + เพิ่มสมาชิก
          </button>
        </div>
      </section>

      {pending.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-rz-muted">สมาชิกที่เพิ่มแล้ว</h2>
          <ul className="space-y-2">
            {pending.map((m) => (
              <li
                key={m.tempId}
                className="flex items-center gap-3 rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3"
              >
                <RoleIconTile role={m.role} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-rz-text">{m.name}</p>
                  <p className={`text-xs ${ROLE_STYLES[m.role].text}`}>
                    {SHOP_MEMBER_ROLE_LABELS[m.role]} ·{" "}
                    {formatMoney(m.investmentAmount.toFixed(2), currency)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removePending(m.tempId)}
                  className="tap-target shrink-0 px-2 text-sm text-rz-hint active:text-rz-red"
                  aria-label={`ลบ ${m.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <p className="text-sm text-rz-red" role="alert">
          {error}
        </p>
      )}

      <SetupPrimaryButton onClick={createShop} disabled={saving || !shopName.trim()}>
        {saving ? "กำลังสร้าง…" : "สร้างร้าน"}
      </SetupPrimaryButton>

      <p className="text-center">
        <Link href="/" className="text-sm text-rz-hint">
          ยกเลิก
        </Link>
      </p>
    </div>
  );
}
