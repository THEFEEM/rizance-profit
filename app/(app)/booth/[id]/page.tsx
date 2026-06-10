import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getBooth } from "@/lib/booth-queries";
import { BoothBack } from "@/components/booth/BoothBack";
import { formatDayShort } from "@/lib/date";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

/** Placeholder hub until Step 3+ — list links here so navigation works. */
export default async function BoothHubPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const booth = await getBooth(user.id, id);
  if (!booth) notFound();

  return (
    <div className="px-4 pb-6">
      <BoothBack href="/booth" />
      <h1 className="text-lg font-bold text-slate-900">{booth.name}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {formatDayShort(booth.startDate)}
        {booth.endDate !== booth.startDate && ` – ${formatDayShort(booth.endDate)}`}
        {" · "}
        งบ {formatMoney(booth.startingBudget, user.currency)}
      </p>
      <p className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
        หน้านี้จะเชื่อมรายรับ/รายจ่ายและสรุปกำไรใน Step ถัดไป
      </p>
    </div>
  );
}
