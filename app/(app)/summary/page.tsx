import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { CONTEXT_COOKIE, resolveTodayContext } from "@/lib/context";
import {
  RegularStatsSummary,
  parseRegularStatsParams,
} from "@/components/stats/RegularStatsSummary";
import {
  BoothStatsSummary,
  parseBoothStatsDate,
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

  if (ctx.mode === "project") {
    redirect(`/projects/${ctx.projectId}/summary`);
  }

  const { period, closeDate } = parseRegularStatsParams(params);

  return (
    <div className="pb-6">
      <div className="flex items-center justify-between px-4 pt-3">
        <h1 className="text-lg font-medium text-rz-text">สถิติ</h1>
        {ctx.mode === "regular" && (
          <Link href="/pricing" className="text-sm font-medium text-rz-green">
            ต้นทุนและราคา →
          </Link>
        )}
      </div>

      {ctx.mode === "regular" ? (
        <RegularStatsSummary user={user} period={period} closeDate={closeDate} />
      ) : (
        <BoothStatsSummary
          user={user}
          booth={ctx.booth}
          closeDate={parseBoothStatsDate(ctx.booth, params)}
        />
      )}
    </div>
  );
}
