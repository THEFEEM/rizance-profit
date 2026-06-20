import { redirect } from "next/navigation";
import { PersonalEntryForm } from "@/components/personal/PersonalEntryForm";
import { listPersonalEntriesAll } from "@/lib/personal-queries";
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
  const entries = await listPersonalEntriesAll(user.id, 20);

  return (
    <PersonalEntryForm
      initialTab={tab}
      entries={entries}
      currency={user.currency}
    />
  );
}
