"use client";

import { useState, type CSSProperties } from "react";
import { formatMoney } from "@/lib/format";
import type { ChatReceiptCardData } from "@/lib/chat-types";

const STATUS_COLORS = {
  pending: "#FCD34D",
  confirmed: "#4ADE9E",
  cancelled: "#5A7499",
} as const;

const STATUS_LABELS = {
  pending: "รอยืนยัน",
  confirmed: "ยืนยันแล้ว",
  cancelled: "ยกเลิกแล้ว",
} as const;

const CATEGORY_BADGE_COLORS: Record<string, string> = {
  materials: "#4ADE9E",
  beverages: "#93C5FD",
  equipment: "#FCD34D",
  packaging: "#C4B5FD",
  utilities: "#FCA5A5",
  other: "#8A9AB5",
};

function categoryBadgeStyle(category: string): CSSProperties {
  const color = CATEGORY_BADGE_COLORS[category] ?? CATEGORY_BADGE_COLORS.other;
  return {
    color,
    backgroundColor: `${color}26`,
  };
}

export function ChatReceiptCard({
  messageId,
  card,
  onConfirm,
  onCancel,
  onUpdateItem: _onUpdateItem,
  onReceiptMetaChange,
}: {
  messageId: string;
  card: ChatReceiptCardData;
  onConfirm: (messageId: string) => Promise<void>;
  onCancel: (messageId: string) => Promise<void>;
  onUpdateItem: (messageId: string, itemId: string, category: string) => Promise<void>;
  onReceiptMetaChange: (
    messageId: string,
    meta: { paymentMethod: "cash" | "transfer" },
  ) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = loading || savingPayment;

  const selectedCount = card.items.filter((item) => item.selected).length;
  const itemsMismatch =
    Math.abs(parseFloat(card.itemsSum) - parseFloat(card.totalAmount)) > 0.5;

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      await onConfirm(messageId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    setLoading(true);
    setError(null);
    try {
      await onCancel(messageId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ยกเลิกไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  async function handlePaymentChange(next: "cash" | "transfer") {
    if (next === card.paymentMethod) return;

    setSavingPayment(true);
    setError(null);
    try {
      await onReceiptMetaChange(messageId, { paymentMethod: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSavingPayment(false);
    }
  }

  return (
    <div className="max-w-[85%] overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
      <div className="border-b-[0.5px] border-rz-border px-4 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-medium text-rz-text">
            {card.merchantName ?? "ใบเสร็จ"}
          </p>
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{
              color: STATUS_COLORS[card.status],
              backgroundColor: `${STATUS_COLORS[card.status]}26`,
            }}
          >
            {STATUS_LABELS[card.status]}
          </span>
        </div>
        <p className="mt-1 text-xs text-rz-hint">{card.entryDate}</p>
        {card.status === "pending" ? (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex rounded-lg border-[0.5px] border-[#243049] p-0.5">
              {(["cash", "transfer"] as const).map((method) => (
                <button
                  key={method}
                  type="button"
                  disabled={busy}
                  onClick={() => void handlePaymentChange(method)}
                  className={`rounded-md px-2.5 py-1 text-xs ${
                    card.paymentMethod === method
                      ? "bg-[#243049] text-[#E8F0FA]"
                      : "bg-transparent text-[#5A7499]"
                  } ${busy ? "opacity-60" : ""}`}
                >
                  {method === "cash" ? "เงินสด" : "โอน"}
                </button>
              ))}
            </div>
            {savingPayment && (
              <span className="text-xs text-rz-hint">กำลังบันทึก…</span>
            )}
          </div>
        ) : (
          <p className="mt-1 text-xs text-rz-hint">
            {card.paymentMethod === "cash" ? "เงินสด" : "เงินโอน"}
          </p>
        )}
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <span className="text-xs text-rz-muted">{card.items.length} รายการ</span>
          <span className="rz-tabular text-lg font-medium text-rz-text">
            {formatMoney(card.totalAmount)}
          </span>
        </div>
        {itemsMismatch && (
          <p className="mt-2 text-xs" style={{ color: "#F87171" }}>
            ยอดรวมรายการ ({formatMoney(card.itemsSum)}) ไม่ตรงกับยอดใบเสร็จ (
            {formatMoney(card.totalAmount)})
          </p>
        )}
        {card.confidence === "low" && (
          <p className="mt-2 text-xs" style={{ color: "#F87171" }}>
            Rizq ไม่แน่ใจ ตรวจสอบด้วยนะคะ
          </p>
        )}
      </div>

      <div
        className={`px-4 py-3 ${card.items.length > 6 ? "max-h-[220px] overflow-y-auto" : ""}`}
      >
        <ul className="flex flex-col gap-2.5">
          {card.items.map((item, index) => (
            <li key={item.id} className="flex items-start gap-2">
              <span className="mt-0.5 w-4 shrink-0 text-xs text-rz-hint">{index + 1}.</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-rz-text">{item.note}</p>
                <span
                  className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px]"
                  style={categoryBadgeStyle(item.category)}
                >
                  {item.categoryLabel}
                </span>
              </div>
              <span className="rz-tabular shrink-0 text-sm text-rz-text">
                {formatMoney(item.amount)}
              </span>
            </li>
          ))}
        </ul>
        {error && (
          <p className="mt-3 text-xs" style={{ color: "#F87171" }} role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="border-t-[0.5px] border-rz-border px-4 py-2.5">
        {card.status === "pending" ? (
          <div className={`flex items-center justify-end gap-2 ${busy ? "opacity-60" : ""}`}>
            <button
              type="button"
              onClick={() => void handleCancel()}
              disabled={busy}
              className="tap-target rounded-lg border-[0.5px] border-rz-border px-3 py-1.5 text-xs text-rz-muted"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={busy || selectedCount === 0}
              className="tap-target rounded-lg bg-rz-green px-3 py-1.5 text-xs font-medium text-rz-bg"
            >
              บันทึก {selectedCount} รายการ
            </button>
          </div>
        ) : card.status === "confirmed" ? (
          <p className="text-center text-sm text-rz-green">จดสำเร็จ ✓</p>
        ) : (
          <p className="text-center text-xs text-rz-muted">ยกเลิกแล้ว</p>
        )}
      </div>
    </div>
  );
}
