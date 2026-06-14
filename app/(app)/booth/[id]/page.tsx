import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { boothSummary, getBooth, splitProfit } from "@/lib/booth-queries";
import { BoothBack } from "@/components/booth/BoothBack";
import { BoothCloseButton } from "@/components/booth/BoothCloseButton";
import { BoothClosedBanner } from "@/components/booth/BoothClosedBanner";
import { BoothSummaryCard } from "@/components/booth/BoothSummaryCard";
import { TentIcon } from "@/components/booth/summary/icons";
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
    <div className="px-4 pb-6" data-context="booth">
      <BoothBack href="/booth" />
      <div className="mt-1 flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border-[0.5px] border-[#5A3F12] bg-[#2E2310] text-rz-amber">
          <TentIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-medium text-rz-text">{booth.name}</h1>
          <p className="mt-0.5 text-sm text-rz-amber">
            {formatDayShort(booth.startDate)}
            {booth.endDate !== booth.startDate && ` – ${formatDayShort(booth.endDate)}`}
            {" · "}
            งบ {formatMoney(booth.totalBudget, user.currency)}
            {closed ? " · ปิดแล้ว" : " · เปิดอยู่"}
          </p>
        </div>
      </div>

      {closed && (
        <div className="mt-4">
          <BoothClosedBanner />
        </div>
      )}

      {!closed && (
        <div className="mt-6 grid grid-cols-2 gap-3">
          <HubAction href={`/booth/${id}/income`} label="+ รายรับ" />
          <HubAction href={`/booth/${id}/expense`} label="− รายจ่าย" />
        </div>
      )}

      <Link
        href={`/booth/${id}/setup`}
        className="tap-target mt-4 block rounded-[14px] border-[0.5px] border-rz-logo-border bg-rz-logo-bg px-4 py-4 text-center text-base font-medium text-rz-green active:opacity-90"
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
              className="tap-target block rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-4 text-center text-sm font-medium text-rz-muted active:bg-rz-elevated"
            >
              ดูสรุปกำไรบูธ
            </Link>
          )}
        </div>
      )}

      {closed && summary && (
        <Link
          href={`/booth/${id}/summary`}
          className="tap-target mt-3 block text-center text-sm font-medium text-rz-amber active:opacity-90"
        >
          เปิดหน้าสรุปเต็ม →
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

function HubAction({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="tap-target flex h-14 items-center justify-center rounded-[14px] border-[0.5px] border-[#5A3F12] bg-[#2E2310] text-base font-medium text-rz-amber active:opacity-90"
    >
      {label}
    </Link>
  );
}
