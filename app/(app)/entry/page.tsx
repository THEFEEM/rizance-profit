import { redirect } from "next/navigation";
import { ShopEntryForm } from "@/components/entry/ShopEntryForm";
import { periodRange } from "@/lib/date";
import { listExpenseInPeriod, listIncomeInPeriod, listTransfersInPeriod } from "@/lib/queries";
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
  const [incomes, expenses, transfers] = await Promise.all([
    listIncomeInPeriod(user.id, start, end),
    listExpenseInPeriod(user.id, start, end),
    listTransfersInPeriod(user.id, start, end),
  ]);

  return (
    <ShopEntryForm
      initialTab={tab}
      // บิล POS ที่ยกเลิกห้ามโผล่ในหน้าแก้ไขรายการ — แก้/ลบใบ void ไม่ได้
      incomes={incomes.filter((i) => i.voidedAt == null)}
      expenses={expenses}
      transfers={transfers}
      currency={user.currency}
    />
  );
}
