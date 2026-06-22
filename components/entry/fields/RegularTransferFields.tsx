import { EntryField } from "@/components/entry/EntryField";
import { EntryOptionButton } from "@/components/entry/EntryOptionButton";
import { TRANSFER_DIRECTION_LABELS, TRANSFER_DIRECTIONS, type TransferDirection } from "@/types";

export function RegularTransferFields({
  direction,
  onDirectionChange,
  note,
  onNoteChange,
  date,
  onDateChange,
  maxDate,
  disabled = false,
}: {
  direction: TransferDirection;
  onDirectionChange: (v: TransferDirection) => void;
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
        <p className="mb-1.5 text-xs text-rz-muted">ทิศทาง</p>
        <div className="flex flex-col gap-2">
          {TRANSFER_DIRECTIONS.map((d) => (
            <EntryOptionButton
              key={d}
              selected={direction === d}
              disabled={disabled}
              onClick={() => onDirectionChange(d)}
              accent="blue"
              layout="row"
            >
              {TRANSFER_DIRECTION_LABELS[d]}
            </EntryOptionButton>
          ))}
        </div>
      </div>

      <EntryField
        label="บันทึกเพิ่มเติม (ไม่บังคับ)"
        placeholder="เช่น ฝากจากรอบขาย"
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
