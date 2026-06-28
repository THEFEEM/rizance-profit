"use client";

import { useState } from "react";
import { CategoryGrid } from "@/components/CategoryGrid";
import { formatMoney } from "@/lib/format";
import { currencySymbol } from "@/lib/money";
import type { ChatCardData } from "@/lib/chat-queries";
import {
  EXPENSE_CATEGORY_GRID_OPTIONS,
  INCOME_CATEGORY_GRID_OPTIONS,
  type ExpenseCategoryKey,
  type IncomeCategoryKey,
} from "@/types";

export function ChatEntryCard({
  card,
  currency,
  messageId,
  entryId,
  onDelete,
  onCategoryChange,
}: {
  card: ChatCardData;
  currency: string;
  messageId: string;
  entryId: string | null;
  onDelete: (messageId: string) => void;
  onCategoryChange: (messageId: string, category: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const isIncome = card.kind === "income";

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

  return (
    <div className="max-w-[85%] overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
      <div className="border-b-[0.5px] border-rz-border px-4 py-2.5">
        <p className="text-sm font-medium text-rz-text">จดสำเร็จ ✓</p>
      </div>

      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] ${
              isIncome ? "bg-rz-green/15 text-rz-green" : "bg-rz-red/15 text-rz-red"
            }`}
          >
            {isIncome ? "รายรับ" : "รายจ่าย"}
          </span>
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

        <p className="mt-1 text-xs text-rz-hint">
          {card.entryDate} · {card.paymentMethod === "cash" ? "เงินสด" : "เงินโอน"}
        </p>

        {card.confidence === "low" && (
          <p className="mt-2 text-xs text-rz-red">Rizq ไม่แน่ใจ ตรวจสอบด้วยนะคะ</p>
        )}
      </div>

      {editing && entryId && (
        <div className="border-t-[0.5px] border-rz-border px-4 py-3">
          <CategoryGrid
            options={
              isIncome ? INCOME_CATEGORY_GRID_OPTIONS : EXPENSE_CATEGORY_GRID_OPTIONS
            }
            value={card.category as IncomeCategoryKey | ExpenseCategoryKey}
            onChange={(next) => void handleCategoryChange(next)}
            columns={isIncome ? 3 : 2}
            accent="green"
          />
          {saving && (
            <p className="mt-2 text-center text-xs text-rz-hint">กำลังบันทึก…</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between border-t-[0.5px] border-rz-border px-4 py-2">
        {entryId && !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={saving}
            className="tap-target text-xs text-rz-muted"
          >
            แก้หมวด
          </button>
        ) : editing ? (
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={saving}
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
