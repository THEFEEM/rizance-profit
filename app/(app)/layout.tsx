import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { BottomNav } from "@/components/BottomNav";
import { TodayHeader } from "@/components/TodayHeader";
import { today, formatDateLabel } from "@/lib/date";
import { CONTEXT_COOKIE, entryNavRoutes, resolveTodayContext } from "@/lib/context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const rawContext = (await cookies()).get(CONTEXT_COOKIE)?.value;
  const resolved = await resolveTodayContext(user.id, undefined, rawContext);
  const navRoutes = entryNavRoutes(resolved);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-rz-bg">
      <TodayHeader
        shopName={user.shopName}
        dateLabel={formatDateLabel(today())}
        mode={resolved.mode}
      />

      <main className="flex-1">{children}</main>

      <BottomNav
        mode={resolved.mode}
        todayHref={navRoutes.today}
        incomeHref={navRoutes.income}
        expenseHref={navRoutes.expense}
        statsHref={navRoutes.stats}
      />
    </div>
  );
}
