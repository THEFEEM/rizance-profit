import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  boothSummary,
  getBooth,
  listBoothExpense,
  listBoothIncome,
  listBoothMembers,
} from "@/lib/booth-queries";
import { defaultBoothEntryDate } from "@/lib/date";
import { BoothCombinedEntryForm } from "@/components/booth/BoothCombinedEntryForm";

export const dynamic = "force-dynamic";

export default async function BoothEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const { tab } = await searchParams;
  const booth = await getBooth(user.id, id);
  if (!booth) notFound();

  const defaultDate = defaultBoothEntryDate(booth.startDate, booth.endDate);
  const closed = booth.status === "closed";

  const [incomes, expenses, members, summary] = await Promise.all([
    listBoothIncome(user.id, id),
    listBoothExpense(user.id, id),
    listBoothMembers(user.id, id),
    boothSummary(user.id, id),
  ]);

  return (
    <BoothCombinedEntryForm
      boothId={booth.id}
      boothName={booth.name}
      startDate={booth.startDate}
      endDate={booth.endDate}
      closed={closed}
      defaultDate={defaultDate}
      incomes={incomes}
      expenses={expenses}
      members={members}
      totalBudget={booth.totalBudget}
      totalExpense={summary?.totalExpense ?? "0.00"}
      currency={user.currency}
      initialTab={tab}
    />
  );
}
