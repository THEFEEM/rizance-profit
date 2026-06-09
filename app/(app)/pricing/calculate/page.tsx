import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getPricingSummary } from "@/lib/pricing-queries";
import { PricingSummaryTable } from "@/components/pricing/PricingSummaryTable";
import { PricingBack } from "@/components/pricing/PricingBack";
import { PRICING_LABELS } from "@/types/pricing";

export const dynamic = "force-dynamic";

export default async function PricingCalculatePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const summary = await getPricingSummary(user.id);

  return (
    <div>
      <PricingBack />
      <h1 className="px-4 text-lg font-bold text-slate-900">{PRICING_LABELS.calculate}</h1>
      <PricingSummaryTable summary={summary} />
    </div>
  );
}
