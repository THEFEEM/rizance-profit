import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { BottomNav } from "@/components/BottomNav";
import { LogoutButton } from "@/components/LogoutButton";
import { today, formatDateLabel } from "@/lib/date";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

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

      <BottomNav />
    </div>
  );
}
