import { redirect } from "next/navigation";

export default async function BoothIncomeRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/booth/${id}/entry?tab=income`);
}
