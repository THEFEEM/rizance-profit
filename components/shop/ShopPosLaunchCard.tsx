import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { isPosPlanAllowed } from "@/lib/pos-config";
import { findPlan } from "@/lib/pricing";
import type { SubscriptionPlan } from "@/lib/subscription-plan";

type Props = {
  plan: SubscriptionPlan;
  posAppUrl: string;
};

export function ShopPosLaunchCard({ plan, posAppUrl }: Props) {
  const posAllowed = isPosPlanAllowed(plan);

  if (posAllowed) {
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
          เปิดหน้าร้าน (POS)
        </a>
      </div>
    );
  }

  const businessPro = findPlan("business_pro", 30);
  const priceLabel = businessPro ? `฿${businessPro.priceBaht}/เดือน` : null;

  return (
    <div className="mx-4 mt-3 rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-4">
      <p className="text-sm font-medium text-rz-text">เปิดหน้าร้านขายสินค้าได้แล้ว</p>
      <p className="mt-1 text-[13px] text-rz-muted">
        ใช้ POS ขายหน้าร้าน ปิดบิลแล้วบันทึกรายรับเข้าร้านอัตโนมัติ
      </p>
      {priceLabel ? (
        <p className="mt-2 text-base font-semibold text-rz-green">{priceLabel}</p>
      ) : null}
      <Link
        href="/pricing"
        className="tap-target mt-4 inline-flex min-h-10 items-center justify-center rounded-[12px] bg-rz-green px-4 text-sm font-medium text-rz-bg"
      >
        อัปเกรดเป็น Business Pro
      </Link>
    </div>
  );
}
