import { redirect } from "next/navigation";

export default async function BoothMembersRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/booth/${id}/setup`);
}
