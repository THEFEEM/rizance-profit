import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getPricingSettings, listOverheads } from "@/lib/pricing-queries";
import { OverheadsEditor } from "@/components/pricing/OverheadsEditor";
import { PricingBack } from "@/components/pricing/PricingBack";
import { PRICING_LABELS } from "@/types/pricing";

export const dynamic = "force-dynamic";

export default async function OverheadsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [{ items, monthlyTotal }, settings] = await Promise.all([
    listOverheads(user.id),
    getPricingSettings(user.id),
  ]);

  return (
    <div>
      <PricingBack />
      <h1 className="px-4 text-lg font-bold text-slate-900">{PRICING_LABELS.overheads}</h1>
      <OverheadsEditor items={items} settings={settings} monthlyTotal={monthlyTotal} />
    </div>
  );
}
