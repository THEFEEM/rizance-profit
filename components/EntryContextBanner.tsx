/** Display-only banner showing which ledger entries will be recorded into. */
export function EntryContextBanner(
  props: { target: "regular" } | { target: "booth"; name: string },
) {
  if (props.target === "regular") {
    return (
      <div
        data-entry-context="regular"
        className="mx-4 mb-2 rounded-[11px] border-[0.5px] border-rz-green/30 bg-rz-green/10 px-3 py-2 text-center text-sm text-rz-muted"
      >
        บันทึกเข้า: <span className="font-medium text-rz-green">ร้านประจำ</span>
      </div>
    );
  }

  return (
    <div
      data-entry-context="booth"
      className="mx-4 mb-2 rounded-[11px] border-[0.5px] border-rz-amber/40 bg-rz-amber/10 px-3 py-2 text-center text-sm text-rz-amber"
    >
      บันทึกเข้า: <span className="font-medium">{props.name}</span>
    </div>
  );
}
