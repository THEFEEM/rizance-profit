import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listBooths } from "@/lib/booth-queries";
import { BoothBack } from "@/components/booth/BoothBack";
import { BoothList } from "@/components/booth/BoothList";

export const dynamic = "force-dynamic";

export default async function BoothListPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const booths = await listBooths(user.id);

  return (
    <div className="pb-6" data-context="booth">
      <BoothBack href="/" />
      <div className="flex items-center justify-between px-4 pt-1">
        <div>
          <h1 className="text-lg font-medium text-rz-text">งานบูธ</h1>
          <p className="text-xs text-rz-hint">งานบูธ / อีเวนต์</p>
        </div>
        <Link
          href="/booth/new"
          className="tap-target rounded-full border-[0.5px] border-[#5A3F12] bg-[#2E2310] px-4 py-2 text-sm font-medium text-rz-amber active:opacity-90"
        >
          + สร้างงาน
        </Link>
      </div>
      <div className="mt-4 px-4">
        <BoothList booths={booths} currency={user.currency} />
      </div>
    </div>
  );
}
