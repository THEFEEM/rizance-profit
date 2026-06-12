import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getBooth, listBoothMembers } from "@/lib/booth-queries";
import { BoothBack } from "@/components/booth/BoothBack";
import { BoothClosedBanner } from "@/components/booth/BoothClosedBanner";
import { BoothSetup } from "@/components/booth/BoothSetup";

export const dynamic = "force-dynamic";

export default async function BoothSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const booth = await getBooth(user.id, id);
  if (!booth) notFound();

  const members = await listBoothMembers(user.id, id);
  const closed = booth.status === "closed";

  return (
    <div>
      <div className="px-4 pb-2 pt-2">
        <BoothBack href={`/booth/${id}`} />
        <h1 className="text-lg font-bold text-slate-900">ตั้งค่าบูธ / สมาชิก</h1>
        <p className="mt-1 text-sm text-slate-500">{booth.name}</p>
      </div>
      {closed && (
        <div className="mx-4 mb-3">
          <BoothClosedBanner />
        </div>
      )}
      <BoothSetup booth={booth} members={members} closed={closed} currency={user.currency} />
    </div>
  );
}
