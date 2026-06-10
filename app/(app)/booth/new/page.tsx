import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { BoothBack } from "@/components/booth/BoothBack";
import { BoothForm } from "@/components/booth/BoothForm";

export const dynamic = "force-dynamic";

export default async function NewBoothPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div>
      <BoothBack href="/booth" />
      <h1 className="px-4 text-lg font-bold text-slate-900">สร้างงานบูธ</h1>
      <BoothForm />
    </div>
  );
}
