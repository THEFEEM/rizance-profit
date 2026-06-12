import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { boothSummary, getBooth, splitProfit } from "@/lib/booth-queries";
import { BoothBack } from "@/components/booth/BoothBack";
import { BoothCloseButton } from "@/components/booth/BoothCloseButton";
import { BoothSummaryCard } from "@/components/booth/BoothSummaryCard";
import { formatDayShort } from "@/lib/date";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function BoothHubPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const booth = await getBooth(user.id, id);
  if (!booth) notFound();

  const closed = booth.status === "closed";
  const [summary, split] = await Promise.all([
    boothSummary(user.id, id),
    splitProfit(user.id, id),
  ]);

  return (
    <div className="px-4 pb-6">
      <BoothBack href="/booth" />
      <h1 className="text-lg font-bold text-slate-900">{booth.name}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {formatDayShort(booth.startDate)}
        {booth.endDate !== booth.startDate && ` – ${formatDayShort(booth.endDate)}`}
        {" · "}
        งบ {formatMoney(booth.totalBudget, user.currency)}
        {closed ? " · ปิดแล้ว" : " · เปิดอยู่"}
      </p>

      {closed && (
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          งานบูธปิดแล้ว — ไม่สามารถเพิ่มรายการได้
        </p>
      )}

      {!closed && (
        <div className="mt-6 grid grid-cols-2 gap-3">
          <HubAction href={`/booth/${id}/income`} label="+ รายรับ" tone="income" />
          <HubAction href={`/booth/${id}/expense`} label="− รายจ่าย" tone="expense" />
        </div>
      )}

      <Link
        href={`/booth/${id}/setup`}
        className="tap-target mt-4 block rounded-2xl border-2 border-emerald-600 bg-emerald-50 px-4 py-4 text-center text-base font-bold text-emerald-800 shadow-sm active:bg-emerald-100"
      >
        ตั้งค่าบูธ / สมาชิก
      </Link>

      {summary && (
        <div className="mt-6">
          {closed ? (
            <BoothSummaryCard
              summary={summary}
              split={split}
              boothId={id}
              currency={user.currency}
              compact
            />
          ) : (
            <Link
              href={`/booth/${id}/summary`}
              className="tap-target block rounded-2xl border border-slate-200 bg-white px-4 py-4 text-center text-sm font-semibold text-slate-700 shadow-sm active:bg-slate-50"
            >
              ดูสรุปกำไรบูธ
            </Link>
          )}
        </div>
      )}

      {closed && summary && (
        <Link
          href={`/booth/${id}/summary`}
          className="tap-target mt-3 block text-center text-sm font-medium text-slate-500 underline"
        >
          เปิดหน้าสรุปเต็ม
        </Link>
      )}

      {!closed && (
        <div className="mt-8">
          <BoothCloseButton boothId={id} />
        </div>
      )}
    </div>
  );
}

function HubAction({
  href,
  label,
  tone,
}: {
  href: string;
  label: string;
  tone: "income" | "expense";
}) {
  const colors =
    tone === "income"
      ? "bg-emerald-600 text-white active:bg-emerald-700"
      : "bg-red-600 text-white active:bg-red-700";

  return (
    <Link
      href={href}
      className={`tap-target flex h-14 items-center justify-center rounded-2xl text-base font-bold ${colors}`}
    >
      {label}
    </Link>
  );
}
