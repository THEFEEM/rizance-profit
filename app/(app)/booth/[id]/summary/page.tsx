import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { boothSummary } from "@/lib/booth-queries";
import { BoothBack } from "@/components/booth/BoothBack";
import { BoothSummaryCard } from "@/components/booth/BoothSummaryCard";
import { formatDayShort } from "@/lib/date";

export const dynamic = "force-dynamic";

export default async function BoothSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const summary = await boothSummary(user.id, id);
  if (!summary) notFound();

  const { booth } = summary;
  const closed = booth.status === "closed";

  return (
    <div>
      <div className="px-4 pb-2">
        <BoothBack href={`/booth/${id}`} />
        <h1 className="text-lg font-bold text-slate-900">{booth.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {formatDayShort(booth.startDate)}
          {booth.endDate !== booth.startDate && ` – ${formatDayShort(booth.endDate)}`}
          {" · "}
          <span
            className={
              closed
                ? "font-medium text-amber-700"
                : "font-medium text-emerald-700"
            }
          >
            {closed ? "ปิดแล้ว" : "เปิดอยู่"}
          </span>
        </p>
        {closed && (
          <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            สรุปสุดท้าย — อ่านอย่างเดียว
          </p>
        )}
      </div>

      <BoothSummaryCard summary={summary} currency={user.currency} />
    </div>
  );
}
