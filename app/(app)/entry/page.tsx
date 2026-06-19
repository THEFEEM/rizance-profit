import { redirect } from "next/navigation";
import { ShopEntryForm } from "@/components/entry/ShopEntryForm";
import { periodRange } from "@/lib/date";
import { listExpenseInPeriod, listIncomeInPeriod } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function EntryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { tab } = await searchParams;
  const { start, end } = periodRange("last_30");
  const [incomes, expenses] = await Promise.all([
    listIncomeInPeriod(user.id, start, end),
    listExpenseInPeriod(user.id, start, end),
  ]);

  return (
    <ShopEntryForm
      initialTab={tab}
      incomes={incomes}
      expenses={expenses}
      currency={user.currency}
    />
  );
}
