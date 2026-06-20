import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { CONTEXT_COOKIE, resolveTodayContext } from "@/lib/context";
import { listShopMembers } from "@/lib/shop-member-queries";
import { ProfilePageContent } from "@/components/profile/ProfilePageContent";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const rawContext = (await cookies()).get(CONTEXT_COOKIE)?.value;
  const ctx = await resolveTodayContext(user.id, undefined, rawContext);
  const shopMembers = await listShopMembers(user.id);

  return (
    <ProfilePageContent
      user={user}
      mode={ctx.mode}
      boothId={ctx.mode === "booth" ? ctx.boothId : undefined}
      boothName={ctx.mode === "booth" ? ctx.booth.name : undefined}
      projectId={ctx.mode === "project" ? ctx.projectId : undefined}
      shopMembers={shopMembers}
    />
  );
}
