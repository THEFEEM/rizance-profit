import { ShopProfitWithdrawalCard } from "@/components/shop/ShopProfitWithdrawalCard";
import { shopMemberProfitWithdrawable } from "@/lib/shop-profit-withdrawable";

export async function ShopProfitWithdrawalSection({
  userId,
  currency = "THB",
  variant = "full",
}: {
  userId: string;
  currency?: string;
  variant?: "full" | "compact";
}) {
  const members = await shopMemberProfitWithdrawable(userId);
  if (members.length === 0) return null;

  return (
    <ShopProfitWithdrawalCard
      members={members}
      currency={currency}
      variant={variant}
    />
  );
}
