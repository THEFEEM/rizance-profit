import { redirect } from "next/navigation";
import { ShopAdvanceCreditorsSection } from "@/components/shop/ShopAdvanceCreditorsSection";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CreditorsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="pb-6">
      <div className="px-4 pt-3">
        <h1 className="text-lg font-medium text-rz-text">เจ้าหนี้</h1>
        <p className="mt-1 text-sm text-rz-muted">เงินที่สมาชิกหรือบุคคลภายนอกออกแทนร้าน</p>
      </div>
      <ShopAdvanceCreditorsSection userId={user.id} currency={user.currency} />
    </div>
  );
}
