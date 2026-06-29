"use client";

import { useState } from "react";
import { CategoryGrid } from "@/components/CategoryGrid";
import { formatMoney } from "@/lib/format";
import { currencySymbol } from "@/lib/money";
import type { ChatCardData } from "@/lib/chat-types";
import {
  EXPENSE_CATEGORY_GRID_OPTIONS,
  INCOME_CATEGORY_GRID_OPTIONS,
  type ExpenseCategoryKey,
  type IncomeCategoryKey,
} from "@/types";
import {
  PERSONAL_EXPENSE_GRID_OPTIONS,
  PERSONAL_INCOME_GRID_OPTIONS,
  type PersonalExpenseKey,
  type PersonalIncomeKey,
} from "@/lib/personal-categories";

export function ChatEntryCard({
  card,
  currency,
  messageId,
  entryId,
  onDelete,
  onCategoryChange,
  onPaymentMethodChange,
  onKindChange,
  variant = "shop",
}: {
  card: ChatCardData;
  currency: string;
  messageId: string;
  entryId: string | null;
  onDelete: (messageId: string) => void;
  onCategoryChange: (messageId: string, category: string) => Promise<void>;
  onPaymentMethodChange?: (
    messageId: string,
    paymentMethod: "cash" | "transfer",
  ) => Promise<void>;
  onKindChange?: (messageId: string, kind: "income" | "expense") => Promise<void>;
  variant?: "shop" | "personal" | "booth";
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [savingKind, setSavingKind] = useState(false);
  const isPersonal = variant === "personal";
  const isBooth = variant === "booth";
  const isIncome = card.kind === "income";
  const kindBusy = savingKind || savingPayment;
  const showKindToggle = !isPersonal && onKindChange != null;
  const showPaymentToggle =
    !isPersonal && onPaymentMethodChange != null && (!isBooth || isIncome);

  async function handleCategoryChange(next: string) {
    if (next === card.category) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      await onCategoryChange(messageId, next);
      setEditing(false);
    } catch {
      // keep editing open on failure
    } finally {
      setSaving(false);
    }
  }

  async function handlePaymentMethodChange(next: "cash" | "transfer") {
    if (!onPaymentMethodChange || next === card.paymentMethod) return;

    setSavingPayment(true);
    try {
      await onPaymentMethodChange(messageId, next);
    } catch {
      // keep current selection on failure
    } finally {
      setSavingPayment(false);
    }
  }

  async function handleKindChange(next: "income" | "expense") {
    if (!onKindChange || next === card.kind) return;

    setSavingKind(true);
    try {
      await onKindChange(messageId, next);
      setEditing(false);
    } catch {
      // keep current selection on failure
    } finally {
      setSavingKind(false);
    }
  }

  return (
    <div className="max-w-[85%] overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
      <div className="border-b-[0.5px] border-rz-border px-4 py-2.5">
        <p className="text-sm font-medium text-rz-text">จดสำเร็จ ✓</p>
      </div>

      <div className="px-4 py-3">
        {showKindToggle ? (
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border-[0.5px] border-[#243049] p-0.5">
              {(["income", "expense"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  disabled={!entryId || kindBusy}
                  onClick={() => void handleKindChange(kind)}
                  className={`rounded-md px-2.5 py-1 text-xs ${
                    card.kind === kind
                      ? kind === "income"
                        ? "bg-[#4ADE9E22] text-[#4ADE9E]"
                        : "bg-[#F8717122] text-[#F87171]"
                      : "bg-transparent text-[#5A7499]"
                  } ${kindBusy ? "opacity-60" : ""}`}
                >
                  {kind === "income" ? "รายรับ" : "รายจ่าย"}
                </button>
              ))}
            </div>
            {savingKind && <span className="text-xs text-rz-hint">กำลังบันทึก…</span>}
          </div>
        ) : (
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-[10px] ${
              isIncome ? "bg-rz-green/15 text-rz-green" : "bg-rz-red/15 text-rz-red"
            }`}
          >
            {isIncome ? "รายรับ" : "รายจ่าย"}
          </span>
        )}

        <div className={`flex items-center gap-2 ${showKindToggle ? "mt-2" : ""}`}>
          <span className="text-xs text-rz-muted">{card.categoryLabel}</span>
        </div>

        <div className="mt-2 flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-sm text-rz-text">
            {card.note || card.categoryLabel}
          </span>
          <span
            className={`rz-tabular shrink-0 text-lg font-medium ${
              isIncome ? "text-rz-green" : "text-rz-red"
            }`}
          >
            {currencySymbol(currency)}
            {formatMoney(card.amount)}
          </span>
        </div>

        <p className="mt-1 text-xs text-rz-hint">{card.entryDate}</p>

        {card.confidence === "low" && (
          <p className="mt-2 text-xs text-rz-red">Rizq ไม่แน่ใจ ตรวจสอบด้วยนะคะ</p>
        )}
      </div>

      {editing && entryId && (
        <div className="border-t-[0.5px] border-rz-border px-4 py-3">
          <CategoryGrid
            options={
              isPersonal
                ? isIncome
                  ? PERSONAL_INCOME_GRID_OPTIONS
                  : PERSONAL_EXPENSE_GRID_OPTIONS
                : isIncome
                  ? INCOME_CATEGORY_GRID_OPTIONS
                  : EXPENSE_CATEGORY_GRID_OPTIONS
            }
            value={
              isPersonal
                ? (card.category as PersonalIncomeKey | PersonalExpenseKey)
                : (card.category as IncomeCategoryKey | ExpenseCategoryKey)
            }
            onChange={(next) => void handleCategoryChange(next)}
            columns={isIncome ? 3 : 2}
            accent={isPersonal ? "rose" : "green"}
          />
          {saving && (
            <p className="mt-2 text-center text-xs text-rz-hint">กำลังบันทึก…</p>
          )}
        </div>
      )}

      {entryId && showPaymentToggle && (
        <div className="border-t-[0.5px] border-rz-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border-[0.5px] border-[#243049] p-0.5">
              {(["cash", "transfer"] as const).map((method) => (
                <button
                  key={method}
                  type="button"
                  disabled={kindBusy}
                  onClick={() => void handlePaymentMethodChange(method)}
                  className={`rounded-md px-2.5 py-1 text-xs ${
                    card.paymentMethod === method
                      ? "bg-[#243049] text-[#E8F0FA]"
                      : "bg-transparent text-[#5A7499]"
                  } ${kindBusy ? "opacity-60" : ""}`}
                >
                  {method === "cash" ? "เงินสด" : "โอน"}
                </button>
              ))}
            </div>
            {savingPayment && !savingKind && (
              <span className="text-xs text-rz-hint">กำลังบันทึก…</span>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t-[0.5px] border-rz-border px-4 py-2">
        {entryId && !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={saving || savingKind}
            className="tap-target text-xs text-rz-muted"
          >
            แก้หมวด
          </button>
        ) : editing ? (
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={saving || savingKind}
            className="tap-target text-xs text-rz-muted"
          >
            ยกเลิก
          </button>
        ) : (
          <span />
        )}
        {entryId ? (
          <button
            type="button"
            onClick={() => onDelete(messageId)}
            className="tap-target text-xs text-rz-red"
          >
            ลบรายการ
          </button>
        ) : (
          <span className="text-xs text-rz-hint">ลบแล้ว</span>
        )}
      </div>
    </div>
  );
}
