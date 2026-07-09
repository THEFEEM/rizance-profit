import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { CONTEXT_COOKIE, resolveTodayContext } from "@/lib/context";
import { SHOW_ORG_MODE, SHOW_PERSONAL_MODE } from "@/lib/feature-flags";
import { userHasOrgData, userHasPersonalData } from "@/lib/mode-access";
import {
  RegularStatsSummary,
  parseRegularStatsParams,
} from "@/components/stats/RegularStatsSummary";
import {
  BoothStatsSummary,
} from "@/components/stats/BoothStatsSummary";

export const dynamic = "force-dynamic";

export default async function StatsSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; date?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const cookieStore = await cookies();
  const ctx = await resolveTodayContext(
    user.id,
    undefined,
    cookieStore.get(CONTEXT_COOKIE)?.value,
  );

  if (ctx.mode === "project" && (SHOW_ORG_MODE || (await userHasOrgData(user.id)))) {
    redirect(`/projects/${ctx.projectId}/summary`);
  }

  if (ctx.mode === "personal" && (SHOW_PERSONAL_MODE || (await userHasPersonalData(user.id)))) {
    redirect("/personal/summary");
  }

  const { period } = parseRegularStatsParams(params);

  return (
    <div className="pb-6">
      <div className="flex items-center justify-between px-4 pt-3">
        <h1 className="text-lg font-medium text-rz-text">สถิติ</h1>
      </div>

      {ctx.mode === "regular" ? (
        <RegularStatsSummary user={user} period={period} />
      ) : ctx.mode === "booth" ? (
        <BoothStatsSummary user={user} booth={ctx.booth} />
      ) : null}
    </div>
  );
}
