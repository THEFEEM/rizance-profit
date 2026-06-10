import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { resolveTodayContext } from "@/lib/context";
import { ModeSwitcher } from "@/components/ModeSwitcher";
import { RegularToday } from "@/components/today/RegularToday";
import { BoothToday } from "@/components/today/BoothToday";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const ctx = await resolveTodayContext(user.id);

  return (
    <div className="pb-4">
      <ModeSwitcher
        mode={ctx.mode}
        boothId={ctx.mode === "booth" ? ctx.boothId : undefined}
        boothName={ctx.mode === "booth" ? ctx.booth.name : undefined}
      />
      {ctx.mode === "regular" ? (
        <RegularToday user={user} />
      ) : (
        <BoothToday user={user} booth={ctx.booth} date={ctx.date} />
      )}
    </div>
  );
}
