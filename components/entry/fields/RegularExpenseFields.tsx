import { CategoryGrid } from "@/components/CategoryGrid";
import { EntryField } from "@/components/entry/EntryField";
import { EXPENSE_CATEGORY_GRID_OPTIONS, type ExpenseCategoryKey } from "@/types";

export function RegularExpenseFields({
  category,
  onCategoryChange,
  note,
  onNoteChange,
  date,
  onDateChange,
  maxDate,
  disabled = false,
  isAdvance = false,
  onAdvanceChange,
  payerName = "",
  onPayerNameChange,
}: {
  category: ExpenseCategoryKey;
  onCategoryChange: (v: ExpenseCategoryKey) => void;
  note: string;
  onNoteChange: (v: string) => void;
  date: string;
  onDateChange: (v: string) => void;
  maxDate: string;
  disabled?: boolean;
  isAdvance?: boolean;
  onAdvanceChange?: (v: boolean) => void;
  payerName?: string;
  onPayerNameChange?: (v: string) => void;
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
          accent="green"
        />
      </div>

      {onAdvanceChange && (
        <label className="flex items-center gap-2 text-sm text-rz-text">
          <input
            type="checkbox"
            checked={isAdvance}
            disabled={disabled}
            onChange={(e) => onAdvanceChange(e.target.checked)}
            className="h-4 w-4 rounded border-rz-border"
          />
          ออกเงินก่อน (เจ้าหนี้)
        </label>
      )}

      {isAdvance && onPayerNameChange && (
        <EntryField
          label="ชื่อผู้จ่ายล่วงหน้า"
          placeholder="เช่น ชื่อหุ้นส่วน / ผู้ให้กู้"
          value={payerName}
          onChange={(e) => onPayerNameChange(e.target.value)}
          maxLength={120}
          disabled={disabled}
          accent="green"
        />
      )}

      <EntryField
        label="บันทึกเพิ่มเติม (ไม่บังคับ)"
        placeholder="Milk + cups"
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
