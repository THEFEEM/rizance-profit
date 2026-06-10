/** Display-only banner showing which ledger entries will be recorded into. */
export function EntryContextBanner(
  props: { target: "regular" } | { target: "booth"; name: string },
) {
  if (props.target === "regular") {
    return (
      <div className="mx-4 mb-2 rounded-lg bg-slate-100 px-3 py-2 text-center text-sm text-slate-600">
        บันทึกเข้า: <span className="font-semibold text-slate-800">ร้านประจำ</span>
      </div>
    );
  }

  return (
    <div className="mx-4 mb-2 rounded-lg bg-amber-100 px-3 py-2 text-center text-sm text-amber-900">
      บันทึกเข้า: <span className="font-semibold">{props.name}</span>
    </div>
  );
}
