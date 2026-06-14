import Link from "next/link";
import { redirect } from "next/navigation";
import { boothSummary, listBooths } from "@/lib/booth-queries";
import { getCurrentUser } from "@/lib/session";
import { BoothBack } from "@/components/booth/BoothBack";
import { BoothList, type ClosedBoothListItem } from "@/components/booth/BoothList";

export const dynamic = "force-dynamic";

export default async function BoothListPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const booths = await listBooths(user.id);
  const openBooths = booths.filter((b) => b.status === "open");
  const closedBoothRecords = booths.filter((b) => b.status === "closed");

  const closedBooths: ClosedBoothListItem[] = await Promise.all(
    closedBoothRecords.map(async (booth) => {
      const summary = await boothSummary(user.id, booth.id);
      return {
        booth,
        totalIncome: summary?.totalIncome ?? "0.00",
        totalExpense: summary?.totalExpense ?? "0.00",
        profit: summary?.profit ?? "0.00",
      };
    }),
  );

  return (
    <div className="pb-6" data-context="booth">
      <BoothBack href="/" />
      <div className="flex items-center justify-between px-4 pt-1">
        <div>
          <h1 className="text-lg font-medium text-rz-text">งานบูธ</h1>
          <p className="text-xs text-rz-hint">งานบูธ / อีเวนต์</p>
        </div>
        <Link
          href="/booth/new"
          className="tap-target rounded-full border-[0.5px] border-[#5A3F12] bg-[#2E2310] px-4 py-2 text-sm font-medium text-rz-amber active:opacity-90"
        >
          + สร้างงาน
        </Link>
      </div>
      <div className="mt-4 px-4">
        <BoothList
          openBooths={openBooths}
          closedBooths={closedBooths}
          currency={user.currency}
        />
      </div>
    </div>
  );
}
