import { ShopProfitWithdrawalCard } from "@/components/shop/ShopProfitWithdrawalCard";
import { computeShopOnHand, type ShopOnHand } from "@/lib/shop-on-hand";
import { shopMemberProfitWithdrawable } from "@/lib/shop-profit-withdrawable";
import type { MemberProfitWithdrawable } from "@/types/shop";

export async function ShopProfitWithdrawalSection({
  userId,
  currency = "THB",
  variant = "full",
  onHand: onHandProp,
  members: membersProp,
}: {
  userId: string;
  currency?: string;
  variant?: "full" | "compact";
  onHand?: ShopOnHand;
  members?: MemberProfitWithdrawable[];
}) {
  const [members, onHand] = await Promise.all([
    membersProp ? Promise.resolve(membersProp) : shopMemberProfitWithdrawable(userId),
    onHandProp ? Promise.resolve(onHandProp) : computeShopOnHand(userId),
  ]);

  if (members.length === 0) return null;

  return (
    <ShopProfitWithdrawalCard
      members={members}
      onHand={onHand}
      currency={currency}
      variant={variant}
    />
  );
}
