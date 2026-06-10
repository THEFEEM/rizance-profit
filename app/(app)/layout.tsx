import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { BottomNav } from "@/components/BottomNav";
import { LogoutButton } from "@/components/LogoutButton";
import { today, formatDateLabel } from "@/lib/date";
import { CONTEXT_COOKIE, entryNavRoutes, resolveTodayContext } from "@/lib/context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const rawContext = (await cookies()).get(CONTEXT_COOKIE)?.value;
  const resolved = await resolveTodayContext(user.id, undefined, rawContext);
  const navRoutes = entryNavRoutes(resolved);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-slate-900">{user.shopName}</p>
          <p className="text-xs text-slate-500">{formatDateLabel(today())}</p>
        </div>
        <LogoutButton />
      </header>

      <main className="flex-1">{children}</main>

      <BottomNav incomeHref={navRoutes.income} expenseHref={navRoutes.expense} />
    </div>
  );
}
