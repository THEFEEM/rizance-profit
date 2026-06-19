import { EntryField } from "@/components/entry/EntryField";
import type { ProjectExpenseKey } from "@/lib/project-categories";
import { ExpenseCategoryGrid } from "@/components/project/ProjectEntryGrids";
import { ProjectTextArea } from "@/components/project/ProjectField";

export function ProjectShortExpenseFields({
  category,
  onCategoryChange,
  payerName,
  onPayerNameChange,
  label,
  onLabelChange,
  note,
  onNoteChange,
  date,
  onDateChange,
  startDate,
  endDate,
  defaultDate,
  disabled = false,
}: {
  category: ProjectExpenseKey;
  onCategoryChange: (v: ProjectExpenseKey) => void;
  payerName: string;
  onPayerNameChange: (v: string) => void;
  label: string;
  onLabelChange: (v: string) => void;
  note: string;
  onNoteChange: (v: string) => void;
  date: string;
  onDateChange: (v: string) => void;
  startDate: string | null;
  endDate: string | null;
  defaultDate: string;
  disabled?: boolean;
}) {
  return (
    <>
      <div>
        <p className="mb-1.5 text-xs text-rz-muted">หมวดรายจ่าย</p>
        <ExpenseCategoryGrid value={category} onChange={onCategoryChange} disabled={disabled} />
      </div>

      <EntryField
        label="ผู้ออกเงิน (ไม่บังคับ)"
        placeholder="เช่น เหรัญญิก / สมาชิก"
        value={payerName}
        onChange={(e) => onPayerNameChange(e.target.value)}
        maxLength={120}
        disabled={disabled}
        accent="blue"
      />

      <EntryField
        label="ป้ายกำกับ (ไม่บังคับ)"
        placeholder="เช่น ค่าที่ / นม / แก้ว"
        value={label}
        onChange={(e) => onLabelChange(e.target.value)}
        maxLength={120}
        disabled={disabled}
        accent="blue"
      />

      <EntryField
        label="วันที่"
        type="date"
        value={date}
        min={startDate ?? undefined}
        max={endDate ?? undefined}
        disabled={disabled}
        onChange={(e) => onDateChange(e.target.value || defaultDate)}
        accent="blue"
      />

      <ProjectTextArea
        label="บันทึกเพิ่มเติม (ไม่บังคับ)"
        placeholder="รายละเอียดเพิ่มเติม"
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        maxLength={255}
        disabled={disabled}
        rows={2}
      />
    </>
  );
}
