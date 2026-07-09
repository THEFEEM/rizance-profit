import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { SubscriptionPricingContent } from "@/components/pricing/SubscriptionPricingContent";
import { CONTEXT_COOKIE, resolveTodayContext } from "@/lib/context";
import { SHOW_ORG_MODE, SHOW_PERSONAL_MODE } from "@/lib/feature-flags";
import { getCurrentUser } from "@/lib/session";
import type { AppContextMode } from "@/types/context";

export const dynamic = "force-dynamic";

export default async function PublicPricingPage() {
  const user = await getCurrentUser();
  let mode: AppContextMode = SHOW_PERSONAL_MODE ? "personal" : "regular";

  if (user) {
    const rawContext = (await cookies()).get(CONTEXT_COOKIE)?.value;
    const ctx = await resolveTodayContext(user.id, undefined, rawContext);
    mode = ctx.mode;
    if (mode === "personal" && !SHOW_PERSONAL_MODE) mode = "regular";
    if (mode === "project" && !SHOW_ORG_MODE) mode = "regular";
  }

  return (
    <div className="min-h-dvh bg-rz-bg">
      <header className="border-b border-rz-border px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/" className="text-sm font-medium text-rz-text">
            ← Rizance
          </Link>
          {!user && (
            <Link
              href="/register"
              className="rounded-full bg-rz-green px-4 py-2 text-sm font-medium text-rz-bg"
            >
              สมัครฟรี
            </Link>
          )}
        </div>
      </header>
      <Suspense fallback={<div className="px-4 py-8 text-sm text-rz-muted">กำลังโหลด...</div>}>
        <SubscriptionPricingContent mode={mode} />
      </Suspense>
    </div>
  );
}
