import { CategoryGrid } from "@/components/CategoryGrid";
import { EntryField } from "@/components/entry/EntryField";
import {
  PERSONAL_EXPENSE_GRID_OPTIONS,
  PERSONAL_INCOME_GRID_OPTIONS,
} from "@/lib/category-lucide-icons";
import type { PersonalExpenseKey, PersonalIncomeKey } from "@/lib/personal-categories";

export function PersonalIncomeFields({
  category,
  onCategoryChange,
  note,
  onNoteChange,
  date,
  onDateChange,
  maxDate,
  disabled = false,
}: {
  category: PersonalIncomeKey;
  onCategoryChange: (v: PersonalIncomeKey) => void;
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
          options={PERSONAL_INCOME_GRID_OPTIONS}
          value={category}
          onChange={onCategoryChange}
          columns={3}
          accent="rose"
        />
      </div>

      <EntryField
        label="บันทึกเพิ่มเติม (ไม่บังคับ)"
        placeholder="รายละเอียดเพิ่มเติม"
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        maxLength={255}
        disabled={disabled}
        accent="rose"
      />
      <EntryField
        label="วันที่"
        type="date"
        value={date}
        max={maxDate}
        disabled={disabled}
        onChange={(e) => onDateChange(e.target.value || maxDate)}
        accent="rose"
      />
    </>
  );
}

export function PersonalExpenseFields({
  category,
  onCategoryChange,
  note,
  onNoteChange,
  date,
  onDateChange,
  maxDate,
  disabled = false,
}: {
  category: PersonalExpenseKey;
  onCategoryChange: (v: PersonalExpenseKey) => void;
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
          options={PERSONAL_EXPENSE_GRID_OPTIONS}
          value={category}
          onChange={onCategoryChange}
          columns={3}
          accent="rose"
        />
      </div>

      <EntryField
        label="บันทึกเพิ่มเติม (ไม่บังคับ)"
        placeholder="รายละเอียดเพิ่มเติม"
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        maxLength={255}
        disabled={disabled}
        accent="rose"
      />
      <EntryField
        label="วันที่"
        type="date"
        value={date}
        max={maxDate}
        disabled={disabled}
        onChange={(e) => onDateChange(e.target.value || maxDate)}
        accent="rose"
      />
    </>
  );
}
