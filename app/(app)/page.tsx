import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { CONTEXT_COOKIE, resolveTodayContext } from "@/lib/context";
import { ModeSwitcher } from "@/components/ModeSwitcher";
import { RegularToday } from "@/components/today/RegularToday";
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

  return (
    <div className="pb-3">
      <ModeSwitcher
        mode={ctx.mode}
        boothId={ctx.mode === "booth" ? ctx.boothId : undefined}
        boothName={ctx.mode === "booth" ? ctx.booth.name : undefined}
        boothStartDate={ctx.mode === "booth" ? ctx.booth.startDate : undefined}
        boothEndDate={ctx.mode === "booth" ? ctx.booth.endDate : undefined}
        projectId={ctx.mode === "project" ? ctx.projectId : undefined}
        projectName={ctx.mode === "project" ? ctx.project.name : undefined}
        orgName={ctx.mode === "project" ? ctx.project.orgName : undefined}
        projectStartDate={ctx.mode === "project" ? ctx.project.startDate : undefined}
        projectEndDate={ctx.mode === "project" ? ctx.project.endDate : undefined}
      />
      {ctx.mode === "regular" ? (
        <RegularToday user={user} />
      ) : ctx.mode === "booth" ? (
        <BoothToday user={user} booth={ctx.booth} date={ctx.date} />
      ) : (
        <OrgToday user={user} project={ctx.project} />
      )}
    </div>
  );
}
