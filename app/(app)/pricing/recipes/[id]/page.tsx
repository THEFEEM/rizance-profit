import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getMenuItem, getRecipe, listIngredients } from "@/lib/pricing-queries";
import { RecipeEditor } from "@/components/pricing/RecipeEditor";
import { PricingBack } from "@/components/pricing/PricingBack";
import { PRICING_LABELS } from "@/types/pricing";

export const dynamic = "force-dynamic";

export default async function RecipeEditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;

  const [menuItem, recipe, ingredients] = await Promise.all([
    getMenuItem(user.id, id),
    getRecipe(user.id, id),
    listIngredients(user.id),
  ]);
  if (!menuItem) notFound();

  return (
    <div>
      <PricingBack href="/pricing/recipes" />
      <h1 className="px-4 pt-1 text-lg font-medium text-rz-text">{PRICING_LABELS.recipes}</h1>
      <RecipeEditor menuItem={menuItem} recipe={recipe} ingredients={ingredients} />
    </div>
  );
}
