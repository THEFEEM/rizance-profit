import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SubscriptionPricingContent } from "@/components/pricing/SubscriptionPricingContent";
import { CONTEXT_COOKIE, resolveTodayContext } from "@/lib/context";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SubscriptionPricingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const rawContext = (await cookies()).get(CONTEXT_COOKIE)?.value;
  const ctx = await resolveTodayContext(user.id, undefined, rawContext);

  return (
    <Suspense fallback={<div className="px-4 py-8 text-sm text-rz-muted">กำลังโหลด...</div>}>
      <SubscriptionPricingContent mode={ctx.mode} />
    </Suspense>
  );
}
