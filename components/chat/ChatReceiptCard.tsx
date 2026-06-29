"use client";

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { formatMoney } from "@/lib/format";
import {
  CATEGORY_LABELS,
  RECEIPT_ITEM_CATEGORY_KEYS,
  type ChatReceiptCardData,
  type ReceiptItemChanges,
  type ReceiptItemCategoryKey,
  type ReceiptLineItem,
} from "@/lib/chat-types";
import {
  PERSONAL_EXPENSE_CATEGORIES,
} from "@/lib/personal-categories";

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

const INPUT_CLASS =
  "w-full rounded-lg border border-[#243049] bg-[#0E1525] px-2 py-1.5 text-sm text-rz-text focus:border-[#4ADE9E] focus:outline-none";

const PERSONAL_CATEGORY_BADGE_COLORS: Record<string, string> = {
  food: "#F9A8D4",
  transport: "#93C5FD",
  education: "#C4B5FD",
  rent: "#FCA5A5",
  water: "#67E8F9",
  electricity: "#FCD34D",
  internet: "#86EFAC",
  phone: "#A5B4FC",
  health: "#FDA4AF",
  clothing: "#FDBA74",
  donation: "#BEF264",
  installment: "#F0ABFC",
  social: "#7DD3FC",
  other_expense: "#8A9AB5",
};

function personalCategoryBadgeStyle(category: string): CSSProperties {
  const color = PERSONAL_CATEGORY_BADGE_COLORS[category] ?? PERSONAL_CATEGORY_BADGE_COLORS.other_expense;
  return {
    color,
    backgroundColor: `${color}26`,
  };
}

function categoryBadgeStyle(category: string, personal: boolean): CSSProperties {
  if (personal) {
    return personalCategoryBadgeStyle(category);
  }
  const color = CATEGORY_BADGE_COLORS[category] ?? CATEGORY_BADGE_COLORS.other;
  return {
    color,
    backgroundColor: `${color}26`,
  };
}

function CategoryDropdown({
  currentCategory,
  disabled,
  onSelect,
  personal = false,
}: {
  currentCategory: string;
  disabled: boolean;
  onSelect: (category: string) => void;
  personal?: boolean;
}) {
  if (personal) {
    return (
      <div className="mt-1.5 rounded-lg border border-[#243049] bg-[#0E1525] p-2">
        <div className="grid grid-cols-2 gap-1.5">
          {PERSONAL_EXPENSE_CATEGORIES.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(key)}
              className={`rounded-md px-2 py-1 text-[10px] disabled:opacity-60 ${
                key === currentCategory ? "ring-1 ring-rz-rose" : ""
              }`}
              style={personalCategoryBadgeStyle(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1.5 rounded-lg border border-[#243049] bg-[#0E1525] p-2">
      <div className="grid grid-cols-2 gap-1.5">
        {RECEIPT_ITEM_CATEGORY_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(key)}
            className={`rounded-md px-2 py-1 text-[10px] disabled:opacity-60 ${
              key === currentCategory ? "ring-1 ring-[#4ADE9E]" : ""
            }`}
            style={categoryBadgeStyle(key, false)}
          >
            {CATEGORY_LABELS[key]}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReadItemRow({
  index,
  item,
  editable,
  disabled,
  categoryDropdownOpen,
  dropdownRef,
  onEdit,
  onCategoryBadgeClick,
  onSelectCategory,
  savingCategory,
  personal = false,
}: {
  index: number;
  item: ReceiptLineItem;
  editable: boolean;
  disabled: boolean;
  categoryDropdownOpen: boolean;
  dropdownRef: RefObject<HTMLDivElement | null>;
  onEdit: () => void;
  onCategoryBadgeClick: () => void;
  onSelectCategory: (category: string) => void;
  savingCategory: boolean;
  personal?: boolean;
}) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 w-4 shrink-0 text-xs text-rz-hint">{index + 1}.</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {editable ? (
              <button
                type="button"
                onClick={onEdit}
                disabled={disabled}
                className="w-full truncate text-left text-sm text-rz-text disabled:opacity-60"
              >
                {item.note}
              </button>
            ) : (
              <p className="truncate text-sm text-rz-text">{item.note}</p>
            )}
            <div ref={categoryDropdownOpen ? dropdownRef : undefined} className="relative mt-1">
              {editable ? (
                <button
                  type="button"
                  onClick={onCategoryBadgeClick}
                  disabled={disabled}
                  className="inline-block rounded-full px-2 py-0.5 text-[10px] disabled:opacity-60"
                  style={categoryBadgeStyle(item.category, personal)}
                >
                  {item.categoryLabel}
                </button>
              ) : (
                <span
                  className="inline-block rounded-full px-2 py-0.5 text-[10px]"
                  style={categoryBadgeStyle(item.category, personal)}
                >
                  {item.categoryLabel}
                </span>
              )}
              {categoryDropdownOpen && (
                <CategoryDropdown
                  currentCategory={item.category}
                  disabled={savingCategory}
                  onSelect={onSelectCategory}
                  personal={personal}
                />
              )}
            </div>
          </div>
          <span className="rz-tabular shrink-0 text-sm text-rz-text">
            {formatMoney(item.amount)}
          </span>
          {editable && (
            <button
              type="button"
              onClick={onEdit}
              disabled={disabled}
              className="mt-0.5 shrink-0 text-xs text-rz-muted disabled:opacity-60"
              aria-label="แก้รายการ"
            >
              ✎
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function EditItemRow({
  index,
  editNote,
  editAmount,
  saving,
  onNoteChange,
  onAmountChange,
  onCancel,
  onSave,
}: {
  index: number;
  editNote: string;
  editAmount: string;
  saving: boolean;
  onNoteChange: (value: string) => void;
  onAmountChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-2 w-4 shrink-0 text-xs text-rz-hint">{index + 1}.</span>
      <div className="min-w-0 flex-1 space-y-2">
        <input
          type="text"
          value={editNote}
          onChange={(e) => onNoteChange(e.target.value)}
          autoFocus
          disabled={saving}
          className={INPUT_CLASS}
          placeholder="รายการ"
        />
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          value={editAmount}
          onChange={(e) => onAmountChange(e.target.value)}
          disabled={saving}
          className={`${INPUT_CLASS} rz-tabular`}
          placeholder="จำนวนเงิน"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="tap-target text-xs text-rz-muted disabled:opacity-60"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="tap-target rounded-lg bg-rz-green px-2.5 py-1 text-xs font-medium text-rz-bg disabled:opacity-60"
          >
            บันทึก
          </button>
        </div>
      </div>
    </li>
  );
}

export function ChatReceiptCard({
  messageId,
  card,
  onConfirm,
  onCancel,
  onUpdateItem,
  onReceiptMetaChange,
  personal = false,
}: {
  messageId: string;
  card: ChatReceiptCardData;
  onConfirm: (messageId: string) => Promise<void>;
  onCancel: (messageId: string) => Promise<void>;
  onUpdateItem: (
    messageId: string,
    itemId: string,
    changes: ReceiptItemChanges,
  ) => Promise<void>;
  onReceiptMetaChange?: (
    messageId: string,
    meta: { paymentMethod: "cash" | "transfer" },
  ) => Promise<void>;
  personal?: boolean;
}) {
  const showPayment = !personal && onReceiptMetaChange != null;
  const [loading, setLoading] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingCategoryItemId, setEditingCategoryItemId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);

  const busy = loading || savingPayment || savingItem;
  const isPending = card.status === "pending";

  useEffect(() => {
    setEditingItemId(null);
    setEditingCategoryItemId(null);
  }, [card.status]);

  useEffect(() => {
    if (!editingCategoryItemId) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        categoryDropdownRef.current &&
        !categoryDropdownRef.current.contains(e.target as Node)
      ) {
        setEditingCategoryItemId(null);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [editingCategoryItemId]);

  const selectedCount = card.items.filter((item) => item.selected).length;
  const itemsMismatch =
    Math.abs(parseFloat(card.itemsSum) - parseFloat(card.totalAmount)) > 0.5;

  function startEdit(item: ReceiptLineItem) {
    if (!isPending || busy) return;
    setEditingCategoryItemId(null);
    setEditingItemId(item.id);
    setEditNote(item.note);
    setEditAmount(item.amount);
    setError(null);
  }

  function cancelEdit() {
    setEditingItemId(null);
    setEditNote("");
    setEditAmount("");
  }

  function openCategoryPicker(itemId: string) {
    if (!isPending || busy) return;
    setEditingItemId(null);
    setEditingCategoryItemId((current) => (current === itemId ? null : itemId));
    setError(null);
  }

  async function selectCategory(itemId: string, category: string) {
    const item = card.items.find((i) => i.id === itemId);
    if (!item || item.category === category) {
      setEditingCategoryItemId(null);
      return;
    }

    setSavingItem(true);
    setError(null);
    try {
      await onUpdateItem(messageId, itemId, { category });
      setEditingCategoryItemId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSavingItem(false);
    }
  }

  async function saveEdit(itemId: string) {
    const note = editNote.trim();
    const amountNum = parseFloat(editAmount);
    if (!note || !Number.isFinite(amountNum) || amountNum <= 0) {
      setError("กรุณากรอกชื่อรายการและจำนวนเงินให้ถูกต้อง");
      return;
    }

    const item = card.items.find((i) => i.id === itemId);
    if (!item) return;

    const changes: ReceiptItemChanges = {};
    const amountStr = amountNum.toFixed(2);
    if (note !== item.note) changes.note = note;
    if (amountStr !== item.amount) changes.amount = amountStr;

    if (Object.keys(changes).length === 0) {
      cancelEdit();
      return;
    }

    setSavingItem(true);
    setError(null);
    try {
      await onUpdateItem(messageId, itemId, changes);
      cancelEdit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSavingItem(false);
    }
  }

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      await onConfirm(messageId);
      setEditingItemId(null);
      setEditingCategoryItemId(null);
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
      setEditingItemId(null);
      setEditingCategoryItemId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ยกเลิกไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  async function handlePaymentChange(next: "cash" | "transfer") {
    if (!onReceiptMetaChange || next === card.paymentMethod) return;

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
        {showPayment && isPending ? (
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
        ) : showPayment ? (
          <p className="mt-1 text-xs text-rz-hint">
            {card.paymentMethod === "cash" ? "เงินสด" : "เงินโอน"}
          </p>
        ) : null}
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
          {card.items.map((item, index) =>
            editingItemId === item.id ? (
              <EditItemRow
                key={item.id}
                index={index}
                editNote={editNote}
                editAmount={editAmount}
                saving={savingItem}
                onNoteChange={setEditNote}
                onAmountChange={setEditAmount}
                onCancel={cancelEdit}
                onSave={() => void saveEdit(item.id)}
              />
            ) : (
              <ReadItemRow
                key={item.id}
                index={index}
                item={item}
                editable={isPending}
                disabled={busy}
                categoryDropdownOpen={editingCategoryItemId === item.id}
                dropdownRef={categoryDropdownRef}
                onEdit={() => startEdit(item)}
                onCategoryBadgeClick={() => openCategoryPicker(item.id)}
                onSelectCategory={(category) => void selectCategory(item.id, category)}
                savingCategory={savingItem}
                personal={personal}
              />
            ),
          )}
        </ul>
        {error && (
          <p className="mt-3 text-xs" style={{ color: "#F87171" }} role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="border-t-[0.5px] border-rz-border px-4 py-2.5">
        {isPending ? (
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
