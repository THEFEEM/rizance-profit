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
import {
  SHOP_MEMBER_ROLE_LABELS,
  SHOP_MEMBER_ROLES,
  type ShopMember,
  type ShopMemberRole,
} from "@/types/shop";

function memberSubline(m: ShopMember, currency: string): string {
  return `${SHOP_MEMBER_ROLE_LABELS[m.role]} · ${formatMoney(m.investmentAmount, currency)}`;
}

function RoleIconTile({ role }: { role: ShopMemberRole }) {
  const s = ROLE_STYLES[role];
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] ${s.badgeBg} ${s.badgeBorder} ${s.text}`}
    >
      <UserIcon />
    </span>
  );
}

/** Profile/settings — live CRUD via /api/shop/members */
export function ShopMemberEditor({
  members: initialMembers,
  currency = "THB",
}: {
  members: ShopMember[];
  currency?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [role, setRole] = useState<ShopMemberRole>("investor");
  const [investmentRaw, setInvestmentRaw] = useState("");
  const [padOpen, setPadOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addMember() {
    if (!name.trim()) return;
    const amount = investmentRaw === "" ? 0 : Number(investmentRaw);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("กรุณาระบุเงินลงทุนที่ถูกต้อง");
      return;
    }

    setSaving(true);
    setError(null);
    const res = await apiFetch<ShopMember>("/api/shop/members", {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), role, investmentAmount: amount }),
    });

    if (res.ok) {
      setName("");
      setInvestmentRaw("");
      setPadOpen(false);
      router.refresh();
    } else {
      setError(res.message);
    }
    setSaving(false);
  }

  async function removeMember(memberId: string) {
    const res = await apiFetch(`/api/shop/members/${memberId}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  return (
    <section className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
      <div className="border-b-[0.5px] border-rz-border px-4 py-3">
        <h2 className="text-sm font-medium text-rz-text">หุ้นส่วน</h2>
        <p className="mt-0.5 text-xs text-rz-hint">แบ่งกำไรตามสัดส่วนลงทุน (by equity)</p>
      </div>

      <div className="px-4 py-3">
        {initialMembers.length === 0 && (
          <p className="mb-3 text-sm text-rz-hint">ยังไม่มีหุ้นส่วน — เพิ่มได้ด้านล่าง</p>
        )}

        {initialMembers.length > 0 && (
          <ul className="mb-4 space-y-2">
            {initialMembers.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 rounded-[12px] border-[0.5px] border-rz-border bg-rz-elevated px-3 py-2.5"
              >
                <RoleIconTile role={m.role} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-rz-text">{m.name}</p>
                  <p className={`text-xs ${ROLE_STYLES[m.role].text}`}>
                    {memberSubline(m, currency)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeMember(m.id)}
                  className="tap-target shrink-0 px-2 text-sm text-rz-hint active:text-rz-red"
                  aria-label={`ลบ ${m.name}`}
                >
                  ลบ
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-[12px] border-[0.5px] border-rz-border p-3">
          <p className="text-sm font-medium text-rz-text">เพิ่มสมาชิก</p>

          <div className="mt-3 flex flex-wrap gap-2">
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
              label="ชื่อ"
              icon={<UserIcon />}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="mt-3">
            <p className="text-xs text-rz-muted">เงินลงทุน (บาท)</p>
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

          {error && (
            <p className="mt-3 text-sm text-rz-red" role="alert">
              {error}
            </p>
          )}

          <div className="mt-4">
            <SetupPrimaryButton onClick={addMember} disabled={saving || !name.trim()}>
              {saving ? "กำลังบันทึก…" : "เพิ่มสมาชิก"}
            </SetupPrimaryButton>
          </div>
        </div>
      </div>
    </section>
  );
}
