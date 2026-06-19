import { redirect } from "next/navigation";

export default async function ProjectIncomeRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/entry?tab=income`);
}
