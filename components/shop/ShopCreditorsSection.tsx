import { ShopCreditorsCard } from "@/components/shop/ShopCreditorsCard";
import {
  creditorsRemainingTotal,
  listCreditorsWithRepayments,
} from "@/lib/advance-creditors";
import { computeShopOnHand } from "@/lib/shop-on-hand";

export async function ShopCreditorsSection({
  userId,
  currency = "THB",
}: {
  userId: string;
  currency?: string;
}) {
  const [rows, onHand] = await Promise.all([
    listCreditorsWithRepayments(userId),
    computeShopOnHand(userId),
  ]);

  return (
    <ShopCreditorsCard
      rows={rows}
      onHand={onHand}
      totalRemaining={creditorsRemainingTotal(rows)}
      currency={currency}
    />
  );
}
