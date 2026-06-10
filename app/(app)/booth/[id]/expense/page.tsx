import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getBooth, listBoothExpense } from "@/lib/booth-queries";
import { defaultBoothEntryDate } from "@/lib/date";
import { BoothExpenseForm } from "@/components/booth/BoothExpenseForm";

export const dynamic = "force-dynamic";

export default async function BoothExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const booth = await getBooth(user.id, id);
  if (!booth) notFound();

  const entries = await listBoothExpense(user.id, id);

  return (
    <BoothExpenseForm
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
