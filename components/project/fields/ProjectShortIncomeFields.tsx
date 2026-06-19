import { EntryField } from "@/components/entry/EntryField";
import type { ProjectFundingKey } from "@/lib/project-categories";
import { FundingSourceGrid } from "@/components/project/ProjectEntryGrids";
import { ProjectTextArea } from "@/components/project/ProjectField";

export function ProjectShortIncomeFields({
  source,
  onSourceChange,
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
  source: ProjectFundingKey;
  onSourceChange: (v: ProjectFundingKey) => void;
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
        <p className="mb-1.5 text-xs text-rz-muted">แหล่งเงิน</p>
        <FundingSourceGrid value={source} onChange={onSourceChange} disabled={disabled} />
      </div>

      {source === "other_income" && (
        <EntryField
          label="ชื่อแหล่งเงิน"
          placeholder="เช่น เงินบริจาคจากศิษย์เก่า"
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          maxLength={120}
          disabled={disabled}
          accent="blue"
        />
      )}

      {source !== "other_income" && (
        <EntryField
          label="ป้ายกำกับ (ไม่บังคับ)"
          placeholder="เช่น งบจากคณะ งวด 1"
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          maxLength={120}
          disabled={disabled}
          accent="blue"
        />
      )}

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
