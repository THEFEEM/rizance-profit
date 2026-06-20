import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { CONTEXT_COOKIE, resolveTodayContext } from "@/lib/context";
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
      {ctx.mode === "regular" ? (
        <RegularToday user={user} />
      ) : ctx.mode === "personal" ? (
        <div className="px-4 py-10 text-center">
          <p className="text-sm font-medium text-rz-rose">โหมดบุคคล</p>
          <p className="mt-2 text-sm text-rz-hint">หน้าหลักบุคคล — GROUP 3</p>
        </div>
      ) : ctx.mode === "booth" ? (
        <BoothToday user={user} booth={ctx.booth} date={ctx.date} />
      ) : (
        <OrgToday user={user} project={ctx.project} />
      )}
    </div>
  );
}
