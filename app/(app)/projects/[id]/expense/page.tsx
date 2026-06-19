import { redirect } from "next/navigation";

export default async function ProjectExpenseRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/entry?tab=expense`);
}
