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
}: {
  category: ExpenseCategoryKey;
  onCategoryChange: (v: ExpenseCategoryKey) => void;
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
        <p className="mb-1.5 text-xs text-rz-muted">ประเภทรายจ่าย</p>
        <CategoryGrid
          options={EXPENSE_CATEGORY_GRID_OPTIONS}
          value={category}
          onChange={onCategoryChange}
          columns={2}
          accent="green"
        />
      </div>

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
