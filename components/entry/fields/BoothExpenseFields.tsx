import { CategoryGrid } from "@/components/CategoryGrid";
import { EntryField } from "@/components/entry/EntryField";
import { EntryOptionButton } from "@/components/entry/EntryOptionButton";
import { EXPENSE_CATEGORY_GRID_OPTIONS, type ExpenseCategoryKey } from "@/types";
import type { BoothMember } from "@/types/booth";

type PayerKind = "member" | "external";

export function BoothExpenseFields({
  category,
  onCategoryChange,
  label,
  onLabelChange,
  note,
  onNoteChange,
  date,
  onDateChange,
  startDate,
  endDate,
  defaultDate,
  advancePayment,
  onAdvancePaymentChange,
  payerKind,
  onPayerKindChange,
  payerMemberId,
  onPayerMemberIdChange,
  externalPayerName,
  onExternalPayerNameChange,
  members,
  disabled = false,
}: {
  category: ExpenseCategoryKey;
  onCategoryChange: (v: ExpenseCategoryKey) => void;
  label: string;
  onLabelChange: (v: string) => void;
  note: string;
  onNoteChange: (v: string) => void;
  date: string;
  onDateChange: (v: string) => void;
  startDate: string;
  endDate: string;
  defaultDate: string;
  advancePayment: boolean;
  onAdvancePaymentChange: (v: boolean) => void;
  payerKind: PayerKind;
  onPayerKindChange: (v: PayerKind) => void;
  payerMemberId: string;
  onPayerMemberIdChange: (v: string) => void;
  externalPayerName: string;
  onExternalPayerNameChange: (v: string) => void;
  members: BoothMember[];
  disabled?: boolean;
}) {
  return (
    <>
      <div>
        <p className="mb-1.5 text-xs text-rz-muted">ประเภทรายจ่าย</p>
        <CategoryGrid
          options={EXPENSE_CATEGORY_GRID_OPTIONS}
          value={category}
          onChange={onCategoryChange}
          columns={2}
          accent="amber"
        />
      </div>

      <label className="flex items-center gap-3 rounded-[11px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3">
        <input
          type="checkbox"
          checked={advancePayment}
          disabled={disabled}
          onChange={(e) => onAdvancePaymentChange(e.target.checked)}
          className="h-4 w-4 accent-rz-amber"
        />
        <span className="text-sm text-rz-text">ออกเงินก่อน (จ่ายแทนร้าน)</span>
      </label>

      {advancePayment && (
        <div className="space-y-3 rounded-[11px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3">
          <p className="text-sm font-medium text-rz-muted">ผู้จ่ายแทน</p>
          <div className="flex gap-2">
            <EntryOptionButton
              selected={payerKind === "member"}
              disabled={disabled}
              onClick={() => onPayerKindChange("member")}
              accent="amber"
              layout="row"
              className="flex-1"
            >
              สมาชิก
            </EntryOptionButton>
            <EntryOptionButton
              selected={payerKind === "external"}
              disabled={disabled}
              onClick={() => onPayerKindChange("external")}
              accent="amber"
              layout="row"
              className="flex-1"
            >
              บุคคลภายนอก
            </EntryOptionButton>
          </div>

          {payerKind === "member" ? (
            members.length > 0 ? (
              <select
                value={payerMemberId}
                disabled={disabled}
                onChange={(e) => onPayerMemberIdChange(e.target.value)}
                className="tap-target w-full rounded-[11px] border-[0.5px] border-rz-border bg-rz-elevated px-[13px] py-[13px] text-sm text-rz-text outline-none focus:border-rz-amber"
              >
                <option value="">เลือกสมาชิก</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-rz-hint">ยังไม่มีสมาชิก — เลือกบุคคลภายนอกแทน</p>
            )
          ) : (
            <EntryField
              label="ชื่อผู้จ่ายแทน"
              placeholder="เช่น ครูสมชาย / ร้านค้า"
              value={externalPayerName}
              onChange={(e) => onExternalPayerNameChange(e.target.value)}
              maxLength={120}
              disabled={disabled}
              accent="amber"
            />
          )}
        </div>
      )}

      <EntryField
        label="ชื่อรายการ (ไม่บังคับ)"
        placeholder="ค่าที่ / นม / แก้ว"
        value={label}
        onChange={(e) => onLabelChange(e.target.value)}
        maxLength={120}
        disabled={disabled}
        accent="amber"
      />
      <EntryField
        label="บันทึกเพิ่มเติม (ไม่บังคับ)"
        placeholder="รายละเอียดเพิ่มเติม"
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        maxLength={255}
        disabled={disabled}
        accent="amber"
      />
      <EntryField
        label="วันที่"
        type="date"
        value={date}
        min={startDate}
        max={endDate}
        disabled={disabled}
        onChange={(e) => onDateChange(e.target.value || defaultDate)}
        accent="amber"
      />
    </>
  );
}
