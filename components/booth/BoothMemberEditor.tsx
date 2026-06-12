"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { apiFetch } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import {
  MEMBER_ROLE_LABELS,
  MEMBER_ROLES,
  PROFIT_SPLIT_METHOD_LABELS,
  WAGE_TYPE_LABELS,
  WAGE_TYPES,
  type BoothMember,
  type MemberRole,
  type ProfitSplitMethod,
  type WageType,
} from "@/types/booth";

export function BoothMemberEditor({
  boothId,
  members,
  profitSplitMethod,
  closed,
  currency = "THB",
}: {
  boothId: string;
  members: BoothMember[];
  profitSplitMethod: ProfitSplitMethod;
  closed: boolean;
  currency?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [role, setRole] = useState<MemberRole>("investor");
  const [investmentRaw, setInvestmentRaw] = useState("");
  const [splitPercent, setSplitPercent] = useState("");
  const [wageRaw, setWageRaw] = useState("");
  const [wageType, setWageType] = useState<WageType>("daily");
  const [padField, setPadField] = useState<"investment" | "wage" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addMember() {
    if (closed || !name.trim()) return;
    setSaving(true);
    setError(null);

    const body: Record<string, unknown> = { name: name.trim(), role };
    if (role === "investor") {
      body.investmentAmount = investmentRaw === "" ? 0 : Number(investmentRaw);
      if (profitSplitMethod === "custom_percent" && splitPercent !== "") {
        body.splitPercent = Number(splitPercent);
      }
    } else if (role === "employee") {
      body.wageAmount = wageRaw === "" ? 0 : Number(wageRaw);
      body.wageType = wageType;
    }

    const res = await apiFetch<BoothMember>(`/api/booths/${boothId}/members`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setName("");
      setInvestmentRaw("");
      setSplitPercent("");
      setWageRaw("");
      router.refresh();
    } else {
      setError(res.message);
    }
    setSaving(false);
  }

  async function removeMember(memberId: string) {
    if (closed) return;
    const res = await apiFetch(`/api/booths/${boothId}/members/${memberId}`, {
      method: "DELETE",
    });
    if (res.ok) router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-8">
      <p className="text-sm text-slate-500">
        แบ่งกำไร: {PROFIT_SPLIT_METHOD_LABELS[profitSplitMethod]} · สมาชิกไม่มีบัญชีเข้าระบบ
      </p>

      {members.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm">
          {members.map((m) => (
            <li key={m.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">{m.name}</p>
                <p className="text-xs text-slate-500">{MEMBER_ROLE_LABELS[m.role]}</p>
                {m.role === "investor" && Number(m.investmentAmount) > 0 && (
                  <p className="text-xs text-emerald-700">
                    ลงทุน {formatMoney(m.investmentAmount, currency)}
                    {m.splitPercent ? ` · ${m.splitPercent}%` : ""}
                  </p>
                )}
                {m.role === "employee" && m.wageAmount && (
                  <p className="text-xs text-slate-600">
                    ค่าแรง {formatMoney(m.wageAmount, currency)} /{" "}
                    {m.wageType ? WAGE_TYPE_LABELS[m.wageType] : "—"}
                  </p>
                )}
              </div>
              {!closed && (
                <button
                  type="button"
                  onClick={() => removeMember(m.id)}
                  className="tap-target shrink-0 text-sm text-slate-400 active:text-red-600"
                >
                  ลบ
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!closed && (
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-800">เพิ่มสมาชิก</p>

          <div className="mt-3 flex flex-wrap gap-2">
            {MEMBER_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`tap-target rounded-full px-3 py-1.5 text-xs font-semibold ${
                  role === r
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {MEMBER_ROLE_LABELS[r]}
              </button>
            ))}
          </div>

          <div className="mt-3">
            <Input label="ชื่อ" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {role === "investor" && (
            <>
              <div className="mt-3">
                <p className="text-sm text-slate-600">เงินลงทุน (บาท)</p>
                <p className="text-lg font-bold tabular-nums">{formatTyped(investmentRaw) || "0"}</p>
                {padField === "investment" ? (
                  <QuickAmountPad
                    value={investmentRaw}
                    onChange={setInvestmentRaw}
                    onSave={() => setPadField(null)}
                    saveLabel="ตกลง"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setPadField("investment")}
                    className="text-sm text-emerald-700"
                  >
                    ใส่จำนวน →
                  </button>
                )}
              </div>
              {profitSplitMethod === "custom_percent" && (
                <div className="mt-3">
                  <Input
                    label="% แบ่งกำไร"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={splitPercent}
                    onChange={(e) => setSplitPercent(e.target.value)}
                  />
                </div>
              )}
            </>
          )}

          {role === "employee" && (
            <>
              <div className="mt-3 flex gap-2">
                {WAGE_TYPES.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setWageType(w)}
                    className={`tap-target rounded-full px-3 py-1.5 text-xs font-semibold ${
                      wageType === w
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {WAGE_TYPE_LABELS[w]}
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <p className="text-sm text-slate-600">ค่าแรง (บาท)</p>
                <p className="text-lg font-bold tabular-nums">{formatTyped(wageRaw) || "0"}</p>
                {padField === "wage" ? (
                  <QuickAmountPad
                    value={wageRaw}
                    onChange={setWageRaw}
                    onSave={() => setPadField(null)}
                    saveLabel="ตกลง"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setPadField("wage")}
                    className="text-sm text-emerald-700"
                  >
                    ใส่จำนวน →
                  </button>
                )}
              </div>
            </>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <Button className="mt-4" onClick={addMember} disabled={saving || !name.trim()}>
            {saving ? "กำลังบันทึก…" : "เพิ่มสมาชิก"}
          </Button>
        </div>
      )}
    </div>
  );
}
