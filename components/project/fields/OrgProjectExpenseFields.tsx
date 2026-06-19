import { EntryField } from "@/components/entry/EntryField";
import { EntryOptionButton } from "@/components/entry/EntryOptionButton";
import type { ProjectExpenseKey, ProjectFundingKey } from "@/lib/project-categories";
import { FundSourceBalanceGrid } from "@/components/project/FundSourceBalanceGrid";
import { ProjectActivityPicker } from "@/components/project/ProjectActivityPicker";
import type { ActivityPickerOption } from "@/components/project/ProjectActivityPicker";
import { ExpenseCategoryGrid } from "@/components/project/ProjectEntryGrids";
import { ProjectTextArea } from "@/components/project/ProjectField";
import type { FundBalance } from "@/types/project";

export function OrgProjectExpenseFields({
  fundSource,
  onFundSourceChange,
  fundBreakdown,
  selectedActivityId,
  onSelectedActivityChange,
  activityOptions,
  generalActivityId,
  isAdvance,
  onIsAdvanceChange,
  payerName,
  onPayerNameChange,
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
  currency = "THB",
  disabled = false,
}: {
  fundSource: ProjectFundingKey | null;
  onFundSourceChange: (v: ProjectFundingKey | null) => void;
  fundBreakdown: FundBalance[];
  selectedActivityId: string;
  onSelectedActivityChange: (v: string) => void;
  activityOptions: ActivityPickerOption[];
  generalActivityId: string;
  isAdvance: boolean;
  onIsAdvanceChange: (v: boolean) => void;
  payerName: string;
  onPayerNameChange: (v: string) => void;
  category: ProjectExpenseKey;
  onCategoryChange: (v: ProjectExpenseKey) => void;
  label: string;
  onLabelChange: (v: string) => void;
  note: string;
  onNoteChange: (v: string) => void;
  date: string;
  onDateChange: (v: string) => void;
  startDate: string | null;
  endDate: string | null;
  defaultDate: string;
  currency?: string;
  disabled?: boolean;
}) {
  return (
    <>
      <div>
        <p className="mb-1.5 text-xs text-rz-muted">แหล่งเงินทุน (ไม่บังคับ)</p>
        <FundSourceBalanceGrid
          value={fundSource}
          onChange={onFundSourceChange}
          fundBreakdown={fundBreakdown}
          disabled={disabled}
          currency={currency}
        />
      </div>

      <div>
        <p className="mb-1.5 text-xs text-rz-muted">เลือกโครงการ</p>
        <ProjectActivityPicker
          activities={activityOptions}
          generalActivityId={generalActivityId}
          selectedActivityId={selectedActivityId}
          onChange={onSelectedActivityChange}
          disabled={disabled}
          currency={currency}
        />
      </div>

      <div>
        <p className="mb-1.5 text-xs text-rz-muted">ออกเงินก่อน (สำรองจ่าย)</p>
        <div className="flex flex-wrap gap-2">
          <EntryOptionButton
            selected={!isAdvance}
            onClick={() => onIsAdvanceChange(false)}
            disabled={disabled}
            accent="green"
          >
            ปกติ
          </EntryOptionButton>
          <EntryOptionButton
            selected={isAdvance}
            onClick={() => onIsAdvanceChange(true)}
            disabled={disabled}
            accent="amber"
          >
            สำรองจ่าย
          </EntryOptionButton>
        </div>
      </div>

      {isAdvance && (
        <EntryField
          label="ผู้ออกเงิน"
          placeholder="เช่น น้องเอ / เหรัญญิก"
          value={payerName}
          onChange={(e) => onPayerNameChange(e.target.value)}
          maxLength={120}
          disabled={disabled}
          accent="blue"
        />
      )}

      <div>
        <p className="mb-1.5 text-xs text-rz-muted">หมวดรายจ่าย</p>
        <ExpenseCategoryGrid value={category} onChange={onCategoryChange} disabled={disabled} />
      </div>

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
