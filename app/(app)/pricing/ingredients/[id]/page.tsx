import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getIngredient } from "@/lib/pricing-queries";
import { IngredientForm } from "@/components/pricing/IngredientForm";
import { PricingBack } from "@/components/pricing/PricingBack";
import { PRICING_LABELS } from "@/types/pricing";

export const dynamic = "force-dynamic";

export default async function EditIngredientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const ingredient = await getIngredient(user.id, id);
  if (!ingredient) notFound();

  return (
    <div>
      <PricingBack href="/pricing/ingredients" />
      <h1 className="px-4 pt-1 text-lg font-medium text-rz-text">
        แก้ไข{PRICING_LABELS.ingredientName}
      </h1>
      <IngredientForm initial={ingredient} />
    </div>
  );
}
