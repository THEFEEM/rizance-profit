import { redirect } from "next/navigation";

export default async function BoothExpenseRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/booth/${id}/entry?tab=expense`);
}
