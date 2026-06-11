import { redirect } from "next/navigation";
import { PricingHub } from "@/components/pricing/PricingHub";
import { getPricingSummary } from "@/lib/pricing-queries";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const summary = await getPricingSummary(user.id);
  return <PricingHub summary={summary} />;
}
