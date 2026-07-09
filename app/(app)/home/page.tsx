import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { CONTEXT_COOKIE, resolveTodayContext } from "@/lib/context";
import { SHOW_ORG_MODE, SHOW_PERSONAL_MODE } from "@/lib/feature-flags";
import { userHasOrgData, userHasPersonalData } from "@/lib/mode-access";
import { RegularToday } from "@/components/today/RegularToday";
import { PersonalToday } from "@/components/today/PersonalToday";
import { BoothToday } from "@/components/today/BoothToday";
import { OrgToday } from "@/components/today/OrgToday";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const cookieStore = await cookies();
  const ctx = await resolveTodayContext(
    user.id,
    undefined,
    cookieStore.get(CONTEXT_COOKIE)?.value,
  );

  const showPersonal =
    ctx.mode === "personal" && (SHOW_PERSONAL_MODE || (await userHasPersonalData(user.id)));
  const showOrg =
    ctx.mode === "project" && (SHOW_ORG_MODE || (await userHasOrgData(user.id)));

  let content: React.ReactNode;
  if (ctx.mode === "booth") {
    content = <BoothToday user={user} booth={ctx.booth} date={ctx.date} />;
  } else if (showPersonal) {
    content = <PersonalToday user={user} />;
  } else if (showOrg && ctx.mode === "project") {
    content = <OrgToday user={user} project={ctx.project} />;
  } else {
    content = <RegularToday user={user} />;
  }

  return <div className="pb-3">{content}</div>;
}
