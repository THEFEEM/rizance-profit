import { IngredientForm } from "@/components/pricing/IngredientForm";
import { PricingBack } from "@/components/pricing/PricingBack";
import { PRICING_LABELS } from "@/types/pricing";

export default function NewIngredientPage() {
  return (
    <div>
      <PricingBack href="/pricing/ingredients" />
      <h1 className="px-4 pt-1 text-lg font-medium text-rz-text">
        เพิ่ม{PRICING_LABELS.ingredientName}
      </h1>
      <IngredientForm />
    </div>
  );
}
