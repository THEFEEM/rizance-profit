import { BoothBack } from "@/components/booth/BoothBack";
import { TentIcon } from "@/components/booth/summary/icons";
import { formatDayShort } from "@/lib/date";
import { PROFIT_SPLIT_METHOD_LABELS, type Booth, type SplitProfitResult } from "@/types/booth";

export function BoothSummaryHeader({
  booth,
  boothId,
  split,
  closed,
}: {
  booth: Booth;
  boothId: string;
  split: SplitProfitResult | null;
  closed: boolean;
}) {
  const methodLabel =
    split?.method === "by_equity" || booth.profitSplitMethod === "by_equity"
      ? PROFIT_SPLIT_METHOD_LABELS.by_equity
      : null;

  return (
    <header className="px-4 pb-4">
      <BoothBack href={`/booth/${boothId}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[19px] font-medium leading-snug text-rz-text">{booth.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-rz-amber">
            <TentIcon />
            <span>
              {formatDayShort(booth.startDate)}
              {booth.endDate !== booth.startDate && ` – ${formatDayShort(booth.endDate)}`}
              {" · "}
              {closed ? "ปิดแล้ว" : "เปิดอยู่"}
            </span>
          </p>
        </div>
        {methodLabel && (
        <span className="shrink-0 rounded-full border-[0.5px] border-[#5A3F12] bg-[#2E2310] px-3 py-1.5 text-xs font-medium text-rz-amber">
          {methodLabel}
        </span>
        )}
      </div>
      {closed && (
        <p className="mt-3 rounded-[14px] border-[0.5px] border-[#5A3F12] bg-[#2E2310]/60 px-4 py-3 text-sm text-rz-amber">
          สรุปสุดท้าย — อ่านอย่างเดียว
        </p>
      )}
    </header>
  );
}
