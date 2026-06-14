import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listIngredients } from "@/lib/pricing-queries";
import { IngredientList } from "@/components/pricing/IngredientList";
import { PricingBack } from "@/components/pricing/PricingBack";
import { PRICING_LABELS } from "@/types/pricing";

export const dynamic = "force-dynamic";

export default async function IngredientsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const items = await listIngredients(user.id);

  return (
    <div className="pb-6">
      <PricingBack />
      <div className="flex items-center justify-between px-4 pt-1">
        <h1 className="text-lg font-medium text-rz-text">{PRICING_LABELS.ingredients}</h1>
        <Link
          href="/pricing/ingredients/new"
          className="tap-target rounded-full border-[0.5px] border-rz-logo-border bg-rz-logo-bg px-4 py-2 text-sm font-medium text-rz-green active:opacity-90"
        >
          + เพิ่ม
        </Link>
      </div>
      <div className="mt-4 px-4">
        <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
          <IngredientList items={items} />
        </div>
      </div>
    </div>
  );
}
