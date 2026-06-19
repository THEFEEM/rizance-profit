import { CategoryGrid } from "@/components/CategoryGrid";
import { EntryField } from "@/components/entry/EntryField";
import { EntryOptionButton } from "@/components/entry/EntryOptionButton";
import {
  INCOME_CATEGORY_GRID_OPTIONS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type IncomeCategoryKey,
  type PaymentMethod,
} from "@/types";

export function RegularIncomeFields({
  category,
  onCategoryChange,
  paymentMethod,
  onPaymentMethodChange,
  note,
  onNoteChange,
  date,
  onDateChange,
  maxDate,
  disabled = false,
}: {
  category: IncomeCategoryKey;
  onCategoryChange: (v: IncomeCategoryKey) => void;
  paymentMethod: PaymentMethod;
  onPaymentMethodChange: (v: PaymentMethod) => void;
  note: string;
  onNoteChange: (v: string) => void;
  date: string;
  onDateChange: (v: string) => void;
  maxDate: string;
  disabled?: boolean;
}) {
  return (
    <>
      <div>
        <p className="mb-1.5 text-xs text-rz-muted">ประเภทรายรับ</p>
        <CategoryGrid
          options={INCOME_CATEGORY_GRID_OPTIONS}
          value={category}
          onChange={onCategoryChange}
          columns={3}
          accent="green"
        />
      </div>

      <div>
        <p className="mb-1.5 text-xs text-rz-muted">ช่องทางรับเงิน</p>
        <div className="flex flex-wrap gap-2">
          {PAYMENT_METHODS.map((m) => (
            <EntryOptionButton
              key={m}
              selected={paymentMethod === m}
              disabled={disabled}
              onClick={() => onPaymentMethodChange(m)}
              accent="green"
            >
              {PAYMENT_METHOD_LABELS[m]}
            </EntryOptionButton>
          ))}
        </div>
      </div>

      <EntryField
        label="บันทึกเพิ่มเติม (ไม่บังคับ)"
        placeholder="Morning sales"
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        maxLength={255}
        disabled={disabled}
        accent="green"
      />
      <EntryField
        label="วันที่"
        type="date"
        value={date}
        max={maxDate}
        disabled={disabled}
        onChange={(e) => onDateChange(e.target.value || maxDate)}
        accent="green"
      />
    </>
  );
}
