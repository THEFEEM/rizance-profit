import { CategoryGrid } from "@/components/CategoryGrid";
import { EntryField } from "@/components/entry/EntryField";
import {
  PERSONAL_EXPENSE_GRID_OPTIONS,
  PERSONAL_INCOME_GRID_OPTIONS,
} from "@/lib/category-lucide-icons";
import {
  PERSONAL_SAVINGS_DEPOSIT,
  PERSONAL_SAVINGS_WITHDRAWAL,
  type PersonalExpenseKey,
  type PersonalIncomeKey,
} from "@/lib/personal-categories";
import type { SavingsGoal } from "@/types/personal";

function SavingsGoalSelect({
  goals,
  value,
  onChange,
  disabled,
}: {
  goals: SavingsGoal[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  if (goals.length === 0) {
    return (
      <p className="rounded-lg border-[0.5px] border-rz-border bg-rz-elevated px-3 py-2 text-xs text-rz-hint">
        ยังไม่มีเป้าหมายออม — สร้างเป้าหมายที่หน้าหลักก่อน
      </p>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full rounded-lg border-[0.5px] border-rz-border bg-rz-bg px-3 py-2 text-sm text-rz-text outline-none focus:border-rz-rose disabled:opacity-50"
    >
      <option value="">เลือกเป้าหมาย</option>
      {goals.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  );
}

export function PersonalIncomeFields({
  category,
  onCategoryChange,
  note,
  onNoteChange,
  date,
  onDateChange,
  maxDate,
  disabled = false,
  goals,
  savingsGoalId,
  onSavingsGoalChange,
}: {
  category: PersonalIncomeKey;
  onCategoryChange: (v: PersonalIncomeKey) => void;
  note: string;
  onNoteChange: (v: string) => void;
  date: string;
  onDateChange: (v: string) => void;
  maxDate: string;
  disabled?: boolean;
  goals: SavingsGoal[];
  savingsGoalId: string;
  onSavingsGoalChange: (v: string) => void;
}) {
  const isSavings = category === PERSONAL_SAVINGS_WITHDRAWAL;

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

      {isSavings && (
        <div>
          <p className="mb-1.5 text-xs text-rz-muted">เป้าหมายออม</p>
          <SavingsGoalSelect
            goals={goals}
            value={savingsGoalId}
            onChange={onSavingsGoalChange}
            disabled={disabled}
          />
        </div>
      )}

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
  goals,
  savingsGoalId,
  onSavingsGoalChange,
}: {
  category: PersonalExpenseKey;
  onCategoryChange: (v: PersonalExpenseKey) => void;
  note: string;
  onNoteChange: (v: string) => void;
  date: string;
  onDateChange: (v: string) => void;
  maxDate: string;
  disabled?: boolean;
  goals: SavingsGoal[];
  savingsGoalId: string;
  onSavingsGoalChange: (v: string) => void;
}) {
  const isSavings = category === PERSONAL_SAVINGS_DEPOSIT;

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

      {isSavings && (
        <div>
          <p className="mb-1.5 text-xs text-rz-muted">เป้าหมายออม</p>
          <SavingsGoalSelect
            goals={goals}
            value={savingsGoalId}
            onChange={onSavingsGoalChange}
            disabled={disabled}
          />
        </div>
      )}

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
