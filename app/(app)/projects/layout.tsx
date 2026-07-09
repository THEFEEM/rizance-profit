import { redirect } from "next/navigation";
import { guardOrgRoute } from "@/lib/mode-access";
import { getCurrentUser } from "@/lib/session";

export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await guardOrgRoute(user.id);
  return children;
}
