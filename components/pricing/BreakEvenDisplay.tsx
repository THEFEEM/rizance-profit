import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { PRICING_LABELS, type BreakEvenRow } from "@/types/pricing";

function ComparisonBadge({
  comparison,
  estimatedCups,
  breakEvenCups,
}: {
  comparison: BreakEvenRow["comparison"];
  estimatedCups: number;
  breakEvenCups: number;
}) {
  if (!comparison) return null;
  const label =
    comparison === "above"
      ? PRICING_LABELS.aboveBreakEven
      : comparison === "below"
        ? PRICING_LABELS.belowBreakEven
        : PRICING_LABELS.atBreakEven;
  const cls =
    comparison === "above"
      ? "border-[0.5px] border-rz-logo-border bg-rz-logo-bg text-rz-green"
      : comparison === "below"
        ? "border-[0.5px] border-[#5A3F12] bg-[#2E2310] text-rz-amber"
        : "border-[0.5px] border-rz-border bg-rz-elevated text-rz-muted";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-rz-hint">
        {PRICING_LABELS.targetCups} {estimatedCups.toLocaleString()} แก้ว vs จุดคุ้มทุน{" "}
        {breakEvenCups.toLocaleString()} แก้ว
      </span>
      <span className={`rounded-full px-2.5 py-0.5 font-medium ${cls}`}>{label}</span>
    </div>
  );
}

export function BreakEvenRowCard({
  row,
  estimatedCupsPerMonth,
  needsSetup,
}: {
  row: BreakEvenRow;
  estimatedCupsPerMonth: number;
  needsSetup: boolean;
}) {
  const be = row;

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <p className="font-semibold text-slate-900">{be.menuName}</p>
      <p className="mt-0.5 text-xs text-slate-400">{PRICING_LABELS.breakEvenSingleMenu}</p>

      <div className="mt-3 space-y-1 text-sm text-slate-600">
        <p>
          {PRICING_LABELS.contributionPerCup}:{" "}
          <span className="font-semibold tabular-nums text-emerald-700">
            {formatMoney(be.contributionPerCup)}
          </span>
        </p>

        {be.noBreakEven ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            {be.warning}
          </p>
        ) : needsSetup ? (
          <p className="text-sm text-slate-500">
            {PRICING_LABELS.needsFixedCosts}{" "}
            <Link href="/pricing/overheads" className="font-medium text-emerald-700">
              เพิ่มต้นทุนคงที่ →
            </Link>
          </p>
        ) : be.breakEvenCups !== null ? (
          <p>
            {PRICING_LABELS.breakEvenCups}:{" "}
            <span className="text-base font-extrabold tabular-nums text-slate-900">
              {be.breakEvenCups.toLocaleString()}
            </span>{" "}
            แก้ว/เดือน
          </p>
        ) : null}
      </div>

      {be.breakEvenCups !== null && estimatedCupsPerMonth > 0 && (
        <ComparisonBadge
          comparison={be.comparison}
          estimatedCups={estimatedCupsPerMonth}
          breakEvenCups={be.breakEvenCups}
        />
      )}
    </div>
  );
}

export function BreakEvenOverview({
  monthlyOverheadTotal,
  needsSetup,
  estimatedCupsPerMonth,
  rows,
}: {
  monthlyOverheadTotal: string;
  needsSetup: boolean;
  estimatedCupsPerMonth: number;
  rows: BreakEvenRow[];
}) {
  const validRows = rows.filter((r) => r.breakEvenCups !== null && !r.noBreakEven);
  const best = validRows.length
    ? validRows.reduce((a, b) => (a.breakEvenCups! <= b.breakEvenCups! ? a : b))
    : null;

  return (
    <section className="mt-6 rounded-[14px] border-[0.5px] border-rz-border bg-rz-card p-4">
      <h2 className="text-base font-medium text-rz-text">{PRICING_LABELS.breakEven}</h2>
      <p className="mt-1 text-xs text-rz-hint">{PRICING_LABELS.breakEvenSingleMenu}</p>

      <div className="mt-3 space-y-2 text-sm text-rz-muted">
        {needsSetup ? (
          <p>
            {PRICING_LABELS.needsFixedCosts}{" "}
            <Link href="/pricing/overheads" className="font-medium text-rz-green">
              เพิ่มต้นทุนคงที่ →
            </Link>
          </p>
        ) : (
          <p>
            ต้นทุนคงที่/เดือน:{" "}
            <span className="rz-tabular font-medium text-rz-text">
              {formatMoney(monthlyOverheadTotal)}
            </span>
          </p>
        )}

        {rows.length === 0 ? (
          <p className="text-rz-hint">
            ยังไม่มีเมนู —{" "}
            <Link href="/pricing/recipes" className="text-rz-green">
              เพิ่มสูตรเครื่องดื่ม
            </Link>
          </p>
        ) : best ? (
          <p>
            จุดคุ้มทุนต่ำสุด:{" "}
            <span className="font-medium text-rz-text">{best.menuName}</span> —{" "}
            <span className="rz-tabular text-base font-medium text-rz-green">
              {best.breakEvenCups!.toLocaleString()}
            </span>{" "}
            แก้ว/เดือน
          </p>
        ) : (
          <p className="text-xs text-rz-amber">
            ยังคำนวณจุดคุ้มทุนไม่ได้ — ตรวจสอบต้นทุนคงที่และกำไรต่อแก้วของแต่ละเมนู
          </p>
        )}

        {estimatedCupsPerMonth > 0 && best?.breakEvenCups != null && (
          <ComparisonBadge
            comparison={best.comparison}
            estimatedCups={estimatedCupsPerMonth}
            breakEvenCups={best.breakEvenCups}
          />
        )}
      </div>

      {rows.length > 0 && (
        <Link
          href="/pricing/calculate"
          className="tap-target mt-4 inline-block text-sm font-medium text-rz-green active:opacity-90"
        >
          ดูรายละเอียดทุกเมนู →
        </Link>
      )}
    </section>
  );
}
