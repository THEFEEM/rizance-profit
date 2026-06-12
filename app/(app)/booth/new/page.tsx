import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { BoothBack } from "@/components/booth/BoothBack";
import { BoothSetup } from "@/components/booth/BoothSetup";

export const dynamic = "force-dynamic";

export default async function NewBoothPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div>
      <div className="px-4 pb-2 pt-2">
        <BoothBack href="/booth" />
        <h1 className="text-lg font-bold text-slate-900">สร้างงานบูธใหม่</h1>
        <p className="mt-1 text-sm text-slate-500">ตั้งค่าทุน สมาชิก และงบ — หน้าเดียว</p>
      </div>
      <BoothSetup members={[]} closed={false} currency={user.currency} createMode />
    </div>
  );
}
