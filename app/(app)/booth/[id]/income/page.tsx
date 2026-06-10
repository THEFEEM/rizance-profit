import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getBooth, listBoothIncome } from "@/lib/booth-queries";
import { defaultBoothEntryDate } from "@/lib/date";
import { BoothIncomeForm } from "@/components/booth/BoothIncomeForm";

export const dynamic = "force-dynamic";

export default async function BoothIncomePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const booth = await getBooth(user.id, id);
  if (!booth) notFound();

  const entries = await listBoothIncome(user.id, id);

  return (
    <BoothIncomeForm
      boothId={booth.id}
      boothName={booth.name}
      startDate={booth.startDate}
      endDate={booth.endDate}
      closed={booth.status === "closed"}
      defaultDate={defaultBoothEntryDate(booth.startDate, booth.endDate)}
      entries={entries}
      currency={user.currency}
    />
  );
}
