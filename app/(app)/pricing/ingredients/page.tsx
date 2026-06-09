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
      <div className="flex items-center justify-between px-4">
        <h1 className="text-lg font-bold text-slate-900">{PRICING_LABELS.ingredients}</h1>
        <Link
          href="/pricing/ingredients/new"
          className="tap-target rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
        >
          + เพิ่ม
        </Link>
      </div>
      <div className="mx-2 mt-4 overflow-hidden rounded-2xl bg-white shadow-sm">
        <IngredientList items={items} />
      </div>
    </div>
  );
}
