import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listMenuItems } from "@/lib/pricing-queries";
import { RecipeList } from "@/components/pricing/RecipeList";
import { PricingBack } from "@/components/pricing/PricingBack";
import { PRICING_LABELS } from "@/types/pricing";

export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const items = await listMenuItems(user.id);

  return (
    <div className="pb-6">
      <PricingBack />
      <div className="flex items-center justify-between px-4">
        <h1 className="text-lg font-bold text-slate-900">{PRICING_LABELS.recipes}</h1>
        <Link
          href="/pricing/recipes/new"
          className="tap-target rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
        >
          + เมนู
        </Link>
      </div>
      <div className="mx-2 mt-4 overflow-hidden rounded-2xl bg-white shadow-sm">
        <RecipeList items={items} />
      </div>
    </div>
  );
}
