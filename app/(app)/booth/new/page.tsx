import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { BoothSetupHeader } from "@/components/booth/setup/BoothSetupHeader";
import { BoothSetup } from "@/components/booth/BoothSetup";

export const dynamic = "force-dynamic";

export default async function NewBoothPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div>
      <BoothSetupHeader mode="create" backHref="/booth" />
      <BoothSetup members={[]} closed={false} currency={user.currency} createMode />
    </div>
  );
}
