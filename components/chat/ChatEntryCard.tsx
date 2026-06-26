import { formatMoney } from "@/lib/money";
import type { ChatCardData } from "@/lib/chat-queries";

export function ChatEntryCard({
  card,
  currency,
  messageId,
  entryId,
  onDelete,
}: {
  card: ChatCardData;
  currency: string;
  messageId: string;
  entryId: string | null;
  onDelete: (messageId: string) => void;
}) {
  const isIncome = card.kind === "income";

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
            {formatMoney(card.amount, currency)}
          </span>
        </div>

        <p className="mt-1 text-xs text-rz-hint">
          {card.entryDate} · {card.paymentMethod === "cash" ? "เงินสด" : "เงินโอน"}
        </p>

        {card.confidence === "low" && (
          <p className="mt-2 text-xs text-rz-red">AI ไม่แน่ใจ ตรวจสอบด้วยนะคะ</p>
        )}
      </div>

      <div className="flex justify-end border-t-[0.5px] border-rz-border px-4 py-2">
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
