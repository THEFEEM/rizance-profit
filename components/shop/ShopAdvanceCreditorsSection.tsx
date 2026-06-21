import { AdvanceCreditorsSection } from "@/components/shared/AdvanceCreditorsSection";
import { advanceCreditorsTotal, listShopAdvanceCreditors } from "@/lib/advance-creditors";

export async function ShopAdvanceCreditorsSection({
  userId,
  currency = "THB",
}: {
  userId: string;
  currency?: string;
}) {
  const rows = await listShopAdvanceCreditors(userId);
  return (
    <AdvanceCreditorsSection
      rows={rows}
      total={advanceCreditorsTotal(rows)}
      currency={currency}
    />
  );
}
