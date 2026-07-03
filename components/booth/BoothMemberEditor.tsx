"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DeleteConfirm, partnerDeleteConfirmCopy } from "@/components/DeleteConfirm";
import { EntryOptionButton } from "@/components/entry/EntryOptionButton";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { SetupField, SetupPrimaryButton } from "@/components/booth/setup/SetupField";
import { UserIcon } from "@/components/booth/setup/icons";
import { ROLE_STYLES } from "@/components/booth/summary/role-styles";
import { apiFetch } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import {
  MEMBER_ROLE_LABELS,
  MEMBER_ROLES,
  WAGE_TYPE_LABELS,
  WAGE_TYPES,
  type BoothMember,
  type MemberRole,
  type WageType,
} from "@/types/booth";

function memberSubline(m: BoothMember, currency: string): string {
  if (m.role === "investor") {
    return `นักลงทุน · ${formatMoney(m.investmentAmount, currency)}`;
  }
  if (m.role === "manager") {
    const parts: string[] = [];
    if (Number(m.investmentAmount) > 0) {
      parts.push(formatMoney(m.investmentAmount, currency));
    }
    if (m.wageAmount) {
      parts.push(`+ ค่าแรง ${formatMoney(m.wageAmount, currency)}`);
    }
    return `ผู้จัดการ · ${parts.join(" ") || "—"}`;
  }
  return `พนักงาน · ค่าแรง ${m.wageAmount ? formatMoney(m.wageAmount, currency) : "—"}`;
}

function RoleIconTile({ role }: { role: MemberRole }) {
  const s = ROLE_STYLES[role];
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] ${s.badgeBg} ${s.badgeBorder} ${s.text}`}
    >
      <UserIcon />
    </span>
  );
}

export function BoothMemberEditor({
  boothId,
  members,
  closed,
  currency = "THB",
  allowAdd = false,
}: {
  boothId: string;
  members: BoothMember[];
  closed: boolean;
  currency?: string;
  allowAdd?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [role, setRole] = useState<MemberRole>("investor");
  const [investmentRaw, setInvestmentRaw] = useState("");
  const [wageRaw, setWageRaw] = useState("");
  const [wageType, setWageType] = useState<WageType>("daily");
  const [padField, setPadField] = useState<"investment" | "wage" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BoothMember | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function addMember() {
    if (closed || !name.trim()) return;
    setSaving(true);
    setError(null);

    const body: Record<string, unknown> = { name: name.trim(), role };
    if (role === "investor") {
      body.investmentAmount = investmentRaw === "" ? 0 : Number(investmentRaw);
    } else if (role === "employee") {
      body.wageAmount = wageRaw === "" ? 0 : Number(wageRaw);
      body.wageType = wageType;
    } else if (role === "manager") {
      body.investmentAmount = investmentRaw === "" ? 0 : Number(investmentRaw);
      if (wageRaw !== "") {
        body.wageAmount = Number(wageRaw);
        body.wageType = wageType;
      }
    }

    const res = await apiFetch<BoothMember>(`/api/booths/${boothId}/members`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setName("");
      setInvestmentRaw("");
      setWageRaw("");
      router.refresh();
    } else {
      setError(res.message);
    }
    setSaving(false);
  }

  async function confirmRemoveMember() {
    if (closed || !pendingDelete || deleting) return;
    setDeleting(true);
    const res = await apiFetch(`/api/booths/${boothId}/members/${pendingDelete.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setPendingDelete(null);
      router.refresh();
    }
    setDeleting(false);
  }

  const showAddForm = allowAdd && !closed;

  return (
    <section className="px-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-rz-muted">สมาชิก</h2>
        {showAddForm && (
          <a
            href="#add-member-form"
            className="tap-target text-sm font-medium text-rz-green"
          >
            ＋ เพิ่มสมาชิก
          </a>
        )}
      </div>

      {members.length === 0 && (
        <p className="mb-3 text-sm text-rz-hint">
          {showAddForm
            ? "ยังไม่มีสมาชิก — เพิ่มได้ หรือข้ามไปก่อน"
            : "ยังไม่มีสมาชิก"}
        </p>
      )}

      {members.length > 0 && (
        <ul className="mb-4 space-y-2">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-3 rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3"
            >
              <RoleIconTile role={m.role} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-rz-text">{m.name}</p>
                <p className={`text-xs ${ROLE_STYLES[m.role].text}`}>
                  {memberSubline(m, currency)}
                </p>
                {(m.role === "employee" || m.role === "manager") && m.wageType && (
                  <p className="text-xs text-rz-hint">
                    {WAGE_TYPE_LABELS[m.wageType]}
                  </p>
                )}
              </div>
              {!closed && (
                <button
                  type="button"
                  onClick={() => setPendingDelete(m)}
                  className="tap-target shrink-0 px-2 text-sm text-rz-hint active:text-rz-red"
                  aria-label={`ลบ ${m.name}`}
                >
                  ลบ
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {showAddForm && (
        <div id="add-member-form" className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card p-4">
          <p className="text-sm font-medium text-rz-text">เพิ่มสมาชิก</p>

          <div className="mt-3 flex flex-wrap gap-2">
            {MEMBER_ROLES.map((r) => (
              <EntryOptionButton
                key={r}
                selected={role === r}
                onClick={() => setRole(r)}
                accent={r === "manager" ? "amber" : "green"}
                className="text-xs"
              >
                {MEMBER_ROLE_LABELS[r]}
              </EntryOptionButton>
            ))}
          </div>

          <div className="mt-3">
            <SetupField
              label="ชื่อ"
              icon={<UserIcon />}
              iconTone={role === "investor" ? "blue" : "hint"}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {(role === "investor" || role === "manager") && (
            <div className="mt-3">
              <p className="text-xs text-rz-muted">เงินลงทุน (บาท)</p>
              <p className="rz-tabular text-lg font-medium text-rz-text">
                {formatTyped(investmentRaw) || "0"}
              </p>
              {padField === "investment" ? (
                <QuickAmountPad
                  value={investmentRaw}
                  onChange={setInvestmentRaw}
                  onSave={() => setPadField(null)}
                  saveLabel="ตกลง"
                  accent="amber"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setPadField("investment")}
                  className="tap-target text-sm font-medium text-rz-green"
                >
                  ใส่จำนวน →
                </button>
              )}
            </div>
          )}

          {(role === "employee" || role === "manager") && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {WAGE_TYPES.map((w) => (
                  <EntryOptionButton
                    key={w}
                    selected={wageType === w}
                    onClick={() => setWageType(w)}
                    accent="amber"
                    layout="row"
                    className="text-center text-xs"
                  >
                    {WAGE_TYPE_LABELS[w]}
                  </EntryOptionButton>
                ))}
              </div>
              <div className="mt-3">
                <p className="text-xs text-rz-muted">ค่าแรง (บาท)</p>
                <p className="rz-tabular text-lg font-medium text-rz-text">
                  {formatTyped(wageRaw) || "0"}
                </p>
                {padField === "wage" ? (
                  <QuickAmountPad
                    value={wageRaw}
                    onChange={setWageRaw}
                    onSave={() => setPadField(null)}
                    saveLabel="ตกลง"
                    accent="amber"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setPadField("wage")}
                    className="tap-target text-sm font-medium text-rz-green"
                  >
                    ใส่จำนวน →
                  </button>
                )}
              </div>
            </>
          )}

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
      )}

      {pendingDelete && (
        <DeleteConfirm
          {...partnerDeleteConfirmCopy(pendingDelete.name)}
          onConfirm={confirmRemoveMember}
          onCancel={() => !deleting && setPendingDelete(null)}
          busy={deleting}
        />
      )}
    </section>
  );
}
