import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getBooth } from "@/lib/booth-queries";
import { BoothBack } from "@/components/booth/BoothBack";
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

  return (
    <div className="px-4 pb-6">
      <BoothBack href="/booth" />
      <h1 className="text-lg font-bold text-slate-900">{booth.name}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {formatDayShort(booth.startDate)}
        {booth.endDate !== booth.startDate && ` – ${formatDayShort(booth.endDate)}`}
        {" · "}
        งบ {formatMoney(booth.startingBudget, user.currency)}
        {closed && " · ปิดแล้ว"}
      </p>

      {closed && (
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          งานบูธปิดแล้ว — ไม่สามารถเพิ่มรายการได้
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3">
        <HubAction
          href={`/booth/${id}/income`}
          label="+ รายรับ"
          tone="income"
          disabled={closed}
        />
        <HubAction
          href={`/booth/${id}/expense`}
          label="− รายจ่าย"
          tone="expense"
          disabled={closed}
        />
      </div>

      <p className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
        สรุปกำไรบูธจะมาใน Step ถัดไป
      </p>
    </div>
  );
}

function HubAction({
  href,
  label,
  tone,
  disabled,
}: {
  href: string;
  label: string;
  tone: "income" | "expense";
  disabled: boolean;
}) {
  const colors =
    tone === "income"
      ? "bg-emerald-600 text-white active:bg-emerald-700"
      : "bg-red-600 text-white active:bg-red-700";

  if (disabled) {
    return (
      <span
        aria-disabled
        className={`tap-target flex h-14 items-center justify-center rounded-2xl text-base font-bold opacity-40 ${colors}`}
      >
        {label}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={`tap-target flex h-14 items-center justify-center rounded-2xl text-base font-bold ${colors}`}
    >
      {label}
    </Link>
  );
}
