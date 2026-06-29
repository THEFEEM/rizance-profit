import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { CreateShopForm } from "@/components/shop/CreateShopForm";

export const dynamic = "force-dynamic";

export default async function NewShopPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div>
      <div className="px-4 pt-3">
        <Link href="/home" className="text-sm text-rz-hint active:text-rz-muted">
          ← กลับ
        </Link>
      </div>
      <CreateShopForm initialShopName={user.shopName} currency={user.currency} />
    </div>
  );
}
