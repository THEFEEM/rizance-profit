import { ExternalLink } from "lucide-react";
import type { SubscriptionPlan } from "@/lib/subscription-plan";

type Props = {
  plan: SubscriptionPlan;
  posAppUrl: string;
};

/**
 * Direct POS entry — no upsell here. Plan gating happens inside the POS app
 * (posAllowed via /api/pos/session), not on the dashboard card.
 */
export function ShopPosLaunchCard({ posAppUrl }: Props) {
  const href = `${posAppUrl.replace(/\/$/, "")}?ref=dashboard`;
  return (
    <div className="mx-4 mt-3">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="tap-target flex min-h-12 items-center justify-center gap-2 rounded-[14px] bg-rz-green px-4 py-3 text-sm font-semibold text-rz-bg shadow-sm active:opacity-90"
      >
        <ExternalLink size={16} aria-hidden />
        เข้าใช้งาน POS หน้าร้าน
      </a>
    </div>
  );
}
