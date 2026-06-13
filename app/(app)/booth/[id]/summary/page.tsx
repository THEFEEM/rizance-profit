import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { boothSummary, splitProfit } from "@/lib/booth-queries";
import { BoothSummaryView } from "@/components/booth/summary/BoothSummaryView";

export const dynamic = "force-dynamic";

export default async function BoothSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const summary = await boothSummary(user.id, id);
  if (!summary) notFound();

  const split = await splitProfit(user.id, id);

  return (
    <BoothSummaryView
      boothId={id}
      summary={summary}
      split={split}
      currency={user.currency}
    />
  );
}
