"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DeleteConfirm, partnerDeleteConfirmCopy } from "@/components/DeleteConfirm";
import { EntryField } from "@/components/entry/EntryField";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { SetupPrimaryButton } from "@/components/booth/setup/SetupField";
import { UserIcon } from "@/components/booth/setup/icons";
import { ROLE_STYLES } from "@/components/booth/summary/role-styles";
import { apiFetch } from "@/lib/api-client";
import { today } from "@/lib/date";
import { SHOW_CAPITAL_WITHDRAWAL } from "@/lib/feature-flags";
import { formatMoney } from "@/lib/money";
import {
  CAPITAL_DIRECTION_LABELS,
  SHOP_MEMBER_ROLE_LABELS,
  type CapitalDirection,
  type CapitalTransaction,
  type ShopMember,
  type ShopMemberRole,
} from "@/types/shop";

type MemberPanel =
  | { memberId: string; memberName: string; mode: "contribution" | "withdrawal" }
  | { memberId: string; memberName: string; mode: "history" };

function memberSubline(m: ShopMember, currency: string): string {
  return `${SHOP_MEMBER_ROLE_LABELS[m.role]} · ลงทุน ${formatMoney(m.investmentAmount, currency)}`;
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

function CapitalHistoryList({
  transactions,
  currency,
}: {
  transactions: CapitalTransaction[];
  currency: string;
}) {
  if (transactions.length === 0) {
    return <p className="text-sm text-rz-hint">ยังไม่มีประวัติทุน</p>;
  }

  return (
    <ul className="divide-y divide-rz-border rounded-[10px] border-[0.5px] border-rz-border">
      {transactions.map((tx) => {
        const isContribution = tx.direction === "contribution";
        const label = CAPITAL_DIRECTION_LABELS[tx.direction];
        const title = tx.note ? `${label} · ${tx.note}` : label;
        return (
          <li key={tx.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm text-rz-text">{title}</p>
              <p className="text-[10px] text-rz-hint">{tx.entryDate}</p>
            </div>
            <span
              className={`rz-tabular shrink-0 text-sm font-medium ${
                isContribution ? "text-rz-green" : "text-rz-red"
              }`}
            >
              {isContribution ? "+ " : "− "}
              {formatMoney(tx.amount, currency)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Profile/settings — live CRUD via /api/shop/members + capital ledger */
export function ShopMemberEditor({
  members: initialMembers,
  currency = "THB",
}: {
  members: ShopMember[];
  currency?: string;
}) {
  const router = useRouter();

  const [panel, setPanel] = useState<MemberPanel | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ShopMember | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [capitalRaw, setCapitalRaw] = useState("");
  const [capitalPadOpen, setCapitalPadOpen] = useState(false);
  const [capitalNote, setCapitalNote] = useState("");
  const [capitalDate, setCapitalDate] = useState(today());
  const [capitalSaving, setCapitalSaving] = useState(false);
  const [capitalError, setCapitalError] = useState<string | null>(null);
  const [history, setHistory] = useState<CapitalTransaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const maxDate = today();

  useEffect(() => {
    if (!panel || panel.mode !== "history") {
      setHistory([]);
      return;
    }

    let cancelled = false;
    setHistoryLoading(true);
    setCapitalError(null);

    void (async () => {
      const res = await apiFetch<CapitalTransaction[]>(
        `/api/shop/capital?memberId=${encodeURIComponent(panel.memberId)}`,
      );
      if (cancelled) return;
      if (res.ok) {
        setHistory(res.data);
      } else {
        setCapitalError(res.message);
        setHistory([]);
      }
      setHistoryLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [panel]);

  function openCapitalPanel(
    member: ShopMember,
    mode: "contribution" | "withdrawal" | "history",
  ) {
    setPanel({ memberId: member.id, memberName: member.name, mode });
    setCapitalRaw("");
    setCapitalPadOpen(false);
    setCapitalNote("");
    setCapitalDate(today());
    setCapitalError(null);
  }

  function closePanel() {
    setPanel(null);
    setCapitalError(null);
  }

  async function confirmRemoveMember() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    const memberId = pendingDelete.id;
    const res = await apiFetch(`/api/shop/members/${memberId}`, { method: "DELETE" });
    if (res.ok) {
      if (panel?.memberId === memberId) closePanel();
      setPendingDelete(null);
      router.refresh();
    }
    setDeleting(false);
  }

  async function submitCapitalTx(direction: CapitalDirection) {
    if (!panel || panel.mode === "history") return;
    const amount = capitalRaw === "" ? 0 : Number(capitalRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      setCapitalError("กรุณาระบุจำนวนเงินที่ถูกต้อง");
      return;
    }

    setCapitalSaving(true);
    setCapitalError(null);

    const res = await apiFetch<{ transaction: CapitalTransaction; member: ShopMember }>(
      "/api/shop/capital",
      {
        method: "POST",
        body: JSON.stringify({
          memberId: panel.memberId,
          amount,
          direction,
          note: capitalNote.trim() || undefined,
          entryDate: capitalDate,
        }),
      },
    );

    if (res.ok) {
      setCapitalRaw("");
      setCapitalPadOpen(false);
      setCapitalNote("");
      closePanel();
      router.refresh();
    } else {
      setCapitalError(res.message);
    }
    setCapitalSaving(false);
  }

  return (
    <section className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
      <div className="border-b-[0.5px] border-rz-border px-4 py-3">
        <h2 className="text-sm font-medium text-rz-text">หุ้นส่วน</h2>
        <p className="mt-0.5 text-xs text-rz-hint">แบ่งกำไรตามสัดส่วนลงทุน (by equity)</p>
      </div>

      <div className="px-4 py-3">
        {initialMembers.length === 0 && (
          <p className="mb-3 text-sm text-rz-hint">ยังไม่มีหุ้นส่วน</p>
        )}

        {initialMembers.length > 0 && (
          <ul className="mb-4 space-y-2">
            {initialMembers.map((m) => (
              <li
                key={m.id}
                className="rounded-[12px] border-[0.5px] border-rz-border bg-rz-elevated"
              >
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <RoleIconTile role={m.role} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-rz-text">{m.name}</p>
                    <p className={`text-xs ${ROLE_STYLES[m.role].text}`}>
                      {memberSubline(m, currency)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {SHOW_CAPITAL_WITHDRAWAL && (
                      <>
                        <button
                          type="button"
                          onClick={() => openCapitalPanel(m, "contribution")}
                          className="tap-target rounded-full px-2 py-1 text-[11px] font-medium text-rz-green active:bg-rz-card"
                        >
                          เพิ่มทุน
                        </button>
                        <button
                          type="button"
                          onClick={() => openCapitalPanel(m, "withdrawal")}
                          className="tap-target rounded-full px-2 py-1 text-[11px] font-medium text-rz-red active:bg-rz-card"
                        >
                          ถอนทุน
                        </button>
                        <button
                          type="button"
                          onClick={() => openCapitalPanel(m, "history")}
                          className="tap-target rounded-full px-2 py-1 text-[11px] font-medium text-rz-hint active:bg-rz-card"
                        >
                          ประวัติ
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setPendingDelete(m)}
                      className="tap-target rounded-full px-2 py-1 text-[11px] text-rz-hint active:text-rz-red"
                      aria-label={`ลบ ${m.name}`}
                    >
                      ลบ
                    </button>
                  </div>
                </div>

                {SHOW_CAPITAL_WITHDRAWAL && panel?.memberId === m.id && (
                  <div className="border-t-[0.5px] border-rz-border px-3 py-3">
                    {panel.mode === "history" ? (
                      <>
                        <p className="mb-2 text-xs font-medium text-rz-muted">
                          ประวัติทุน — {panel.memberName}
                        </p>
                        {historyLoading ? (
                          <p className="text-sm text-rz-hint">กำลังโหลด…</p>
                        ) : (
                          <CapitalHistoryList transactions={history} currency={currency} />
                        )}
                        <button
                          type="button"
                          onClick={closePanel}
                          className="tap-target mt-3 text-sm text-rz-hint"
                        >
                          ปิด
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="mb-2 text-xs font-medium text-rz-muted">
                          {panel.mode === "contribution" ? "เพิ่มทุน" : "ถอนทุน"} —{" "}
                          {panel.memberName}
                        </p>
                        <p className="rz-tabular mb-2 text-lg font-medium text-rz-text">
                          {formatTyped(capitalRaw) || "0"}
                        </p>
                        {capitalPadOpen ? (
                          <QuickAmountPad
                            value={capitalRaw}
                            onChange={setCapitalRaw}
                            onSave={() => setCapitalPadOpen(false)}
                            saveLabel="ตกลง"
                            accent={panel.mode === "contribution" ? "green" : "rose"}
                            saveTone={panel.mode === "contribution" ? "green" : "rose"}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setCapitalPadOpen(true)}
                            className="tap-target mb-3 text-sm font-medium text-rz-green"
                          >
                            ใส่จำนวน →
                          </button>
                        )}
                        <EntryField
                          label="บันทึกเพิ่มเติม (ไม่บังคับ)"
                          value={capitalNote}
                          onChange={(e) => setCapitalNote(e.target.value)}
                          maxLength={255}
                          accent="green"
                        />
                        <div className="mt-3">
                          <EntryField
                            label="วันที่"
                            type="date"
                            value={capitalDate}
                            max={maxDate}
                            onChange={(e) => setCapitalDate(e.target.value || maxDate)}
                            accent="green"
                          />
                        </div>
                        {capitalError && (
                          <p className="mt-3 text-sm text-rz-red" role="alert">
                            {capitalError}
                          </p>
                        )}
                        <div className="mt-3 flex gap-2">
                          <SetupPrimaryButton
                            onClick={() => submitCapitalTx(panel.mode)}
                            disabled={capitalSaving}
                          >
                            {capitalSaving ? "กำลังบันทึก…" : "บันทึก"}
                          </SetupPrimaryButton>
                          <button
                            type="button"
                            onClick={closePanel}
                            className="tap-target rounded-[11px] px-4 py-2.5 text-sm text-rz-hint"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

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
