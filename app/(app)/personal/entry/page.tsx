import { redirect } from "next/navigation";
import { PersonalEntryForm } from "@/components/personal/PersonalEntryForm";
import { listPersonalEntriesAll, listSavingsGoals } from "@/lib/personal-queries";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PersonalEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { tab } = await searchParams;
  const [entries, goals] = await Promise.all([
    listPersonalEntriesAll(user.id, 20),
    listSavingsGoals(user.id),
  ]);

  return (
    <PersonalEntryForm
      initialTab={tab}
      entries={entries}
      goals={goals}
      currency={user.currency}
    />
  );
}
