import { redirect } from "next/navigation";
import { guardPersonalRoute } from "@/lib/mode-access";
import { getCurrentUser } from "@/lib/session";

export default async function PersonalLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await guardPersonalRoute(user.id);
  return children;
}
