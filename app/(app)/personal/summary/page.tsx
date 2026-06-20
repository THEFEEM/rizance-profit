import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  PersonalStatsSummary,
  parsePersonalStatsParams,
} from "@/components/stats/PersonalStatsSummary";

export const dynamic = "force-dynamic";

export default async function PersonalSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const { period } = parsePersonalStatsParams(params);

  return (
    <div className="pb-6">
      <div className="px-4 pt-3">
        <h1 className="text-lg font-medium text-rz-text">สถิติ</h1>
      </div>
      <PersonalStatsSummary user={user} period={period} />
    </div>
  );
}
