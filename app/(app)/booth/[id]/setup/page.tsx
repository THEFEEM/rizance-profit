import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getBooth, listBoothMembers } from "@/lib/booth-queries";
import { BoothSetupHeader } from "@/components/booth/setup/BoothSetupHeader";
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
      <BoothSetupHeader mode="edit" backHref={`/booth/${id}`} />
      {closed && (
        <div className="mx-4 mb-3">
          <BoothClosedBanner />
        </div>
      )}
      <BoothSetup booth={booth} members={members} closed={closed} currency={user.currency} />
    </div>
  );
}
