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
    <div className="pb-6">
      <BoothBack href="/" />
      <div className="flex items-center justify-between px-4">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Mode Even</h1>
          <p className="text-xs text-slate-500">งานบูธ / อีเวนต์</p>
        </div>
        <Link
          href="/booth/new"
          className="tap-target rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
        >
          + สร้างงาน
        </Link>
      </div>
      <div className="mx-2 mt-4 overflow-hidden rounded-2xl bg-white shadow-sm">
        <BoothList booths={booths} currency={user.currency} />
      </div>
    </div>
  );
}
