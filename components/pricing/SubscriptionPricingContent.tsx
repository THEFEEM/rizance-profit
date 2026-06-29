"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PricingCard, type PricingFeature } from "@/components/pricing/PricingCard";
import { EntryPageHeader } from "@/components/entry/EntryPageHeader";
import { apiFetch } from "@/lib/api-client";
import type { PaidStripePlan } from "@/lib/subscription-plan";
import type { AppContextMode } from "@/types/context";

type SubscriptionStatus = {
  plan: string;
  expiresAt: string | null;
  isExpired: boolean;
};

const FREE_FEATURES: Record<AppContextMode, PricingFeature[]> = {
  personal: [
    { label: "บันทึกรายรับ-รายจ่ายไม่จำกัด", included: true },
    { label: "สแกนสลิปและใบเสร็จ (จำกัดต่อเดือน)", included: true },
    { label: "Rizq AI chat (จำกัดต่อเดือน)", included: true },
    { label: "ดูย้อนหลัง 7 วัน", included: true },
    { label: "Receipt Split", included: false },
  ],
  booth: [
    { label: "บันทึกรายรับ-รายจ่ายไม่จำกัด", included: true },
    { label: "หุ้นส่วน + แบ่งกำไร", included: true },
    { label: "สแกนสลิปและใบเสร็จ (จำกัดต่อเดือน)", included: true },
    { label: "Rizq AI chat (จำกัดต่อเดือน)", included: true },
    { label: "ดูย้อนหลัง 7 วัน", included: true },
    { label: "Receipt Split", included: false },
  ],
  regular: [
    { label: "บันทึกรายรับ-รายจ่ายไม่จำกัด", included: true },
    { label: "สแกนสลิปและใบเสร็จ (จำกัดต่อเดือน)", included: true },
    { label: "Rizq AI chat (จำกัดต่อเดือน)", included: true },
    { label: "ดูย้อนหลัง 7 วัน", included: true },
    { label: "Receipt Split", included: false },
    { label: "หุ้นส่วน + แบ่งกำไร", included: false },
  ],
  project: [
    { label: "จัดการโครงการและกิจกรรม", included: true },
    { label: "บันทึกรายรับ-รายจ่ายไม่จำกัด", included: true },
    { label: "รายงานสรุปโครงการ", included: true },
    { label: "ฟรีระหว่างทดสอบ", included: true },
  ],
};

const EVENT_PASS_FEATURES: PricingFeature[] = [
  { label: "สแกนสลิปและใบเสร็จไม่จำกัด (7 วัน)", included: true },
  { label: "Rizq AI chat 200 ข้อความ", included: true },
  { label: "Receipt Split", included: true },
  { label: "Dashboard เต็มรูปแบบ", included: true },
  { label: "ดูข้อมูลย้อนหลังทั้งหมด", included: true },
  { label: "รายงานเพิ่มเติม", included: true },
];

const BUSINESS_FEATURES: PricingFeature[] = [
  { label: "ช่วย AI วิเคราะห์กำไร", included: true },
  { label: "วิเคราะห์แนวโน้มและต้นทุน", included: true },
  { label: "สแกนสลิปและใบเสร็จ", included: true },
  { label: "สรุปรายงานอัตโนมัติ", included: true },
  { label: "ดูข้อมูลย้อนหลังทั้งหมด", included: true },
  { label: "Receipt Split", included: true },
  { label: "หุ้นส่วน + แบ่งกำไร", included: true },
  { label: "ระบบทุน + ถอนกำไร", included: true },
  { label: "ระบบเจ้าหนี้", included: true },
];

const PERSONAL_PLUS_FEATURES: PricingFeature[] = [
  { label: "บันทึกรายรับ-รายจ่าย ไม่จำกัด", included: true },
  { label: "สแกนสลิป/ใบเสร็จ 100 ครั้ง/เดือน", included: true },
  { label: "Rizq AI 100 ข้อความ/เดือน", included: true },
  { label: "Receipt Split", included: true },
  { label: "Dashboard เต็มรูปแบบ", included: true },
  { label: "ดูข้อมูลย้อนหลัง ไม่จำกัด", included: true },
  { label: "Export", included: false },
];

function freePlanName(mode: AppContextMode): string {
  if (mode === "personal") return "ส่วนตัว (ฟรี)";
  if (mode === "booth") return "บูธ (ฟรี)";
  if (mode === "project") return "องค์กร (ฟรี)";
  return "ร้านค้า (ฟรี)";
}

export function SubscriptionPricingContent({ mode }: { mode: AppContextMode }) {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<PaidStripePlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const success = searchParams.get("success") === "true";
  const canceled = searchParams.get("canceled") === "true";

  useEffect(() => {
    void apiFetch<SubscriptionStatus>("/api/subscription").then((res) => {
      if (res.ok) setStatus(res.data);
    });
  }, [success]);

  const activePlan = status?.plan ?? "free";
  const activeExpiresAt = status?.isExpired ? null : status?.expiresAt ?? null;

  const paidPlan: PaidStripePlan | null = useMemo(() => {
    if (mode === "personal") return "personal_plus";
    if (mode === "booth") return "event_pass";
    if (mode === "regular") return "business";
    return null;
  }, [mode]);

  const showPaidCard = paidPlan != null;

  async function handleSubscribe(plan: PaidStripePlan) {
    setLoadingPlan(plan);
    setError(null);
    const res = await apiFetch<{ url: string }>("/api/checkout", {
      method: "POST",
      body: JSON.stringify({ plan }),
    });
    setLoadingPlan(null);

    if (res.ok && res.data.url) {
      window.location.href = res.data.url;
      return;
    }

    setError(res.ok ? "ไม่สามารถเปิดหน้าชำระเงินได้" : res.message);
  }

  return (
    <div className="px-4 pb-8 pt-4" data-context="subscription-pricing">
      <EntryPageHeader title="เลือกแพ็กเกจ" backLabel="← กลับ" />

      {success && (
        <p className="mb-4 rounded-[12px] border border-rz-green/30 bg-rz-green/10 px-4 py-3 text-sm text-rz-green">
          ชำระเงินสำเร็จ — สิทธิ์ของคุณเปิดใช้งานแล้ว
        </p>
      )}
      {canceled && (
        <p className="mb-4 rounded-[12px] border border-rz-border bg-rz-elevated px-4 py-3 text-sm text-rz-muted">
          ยกเลิกการชำระเงิน
        </p>
      )}
      {error && (
        <p className="mb-4 text-sm text-rz-red" role="alert">
          {error}
        </p>
      )}

      <div
        className={`grid gap-4 ${showPaidCard ? "md:grid-cols-2" : "grid-cols-1"}`}
      >
        <PricingCard
          name={freePlanName(mode)}
          price="฿0"
          period="ตลอด"
          features={FREE_FEATURES[mode]}
          isActive={activePlan === "free"}
        />

        {paidPlan === "personal_plus" && (
          <PricingCard
            name="Personal Plus"
            price="฿49"
            period="เดือน"
            features={PERSONAL_PLUS_FEATURES}
            isActive={activePlan === "personal_plus"}
            expiresAt={activePlan === "personal_plus" ? activeExpiresAt : null}
            recommended
            loading={loadingPlan === "personal_plus"}
            subscribeLabel={
              activePlan === "personal_plus" && status?.isExpired ? "ต่ออายุ ฿49" : undefined
            }
            onSubscribe={() => handleSubscribe("personal_plus")}
          />
        )}

        {paidPlan === "event_pass" && (
          <PricingCard
            name="Event Pass"
            price="฿49"
            period="7 วัน"
            features={EVENT_PASS_FEATURES}
            isActive={activePlan === "event_pass"}
            expiresAt={activePlan === "event_pass" ? activeExpiresAt : null}
            recommended
            loading={loadingPlan === "event_pass"}
            subscribeLabel={activePlan === "event_pass" && status?.isExpired ? "ต่ออายุ ฿49" : undefined}
            onSubscribe={() => handleSubscribe("event_pass")}
          />
        )}

        {paidPlan === "business" && (
          <PricingCard
            name="Business"
            price="฿99"
            period="เดือน"
            features={BUSINESS_FEATURES}
            footnote="ใช้งาน AI ได้ถึง 200 ครั้งต่อเดือน ตามนโยบาย Fair Usage"
            isActive={activePlan === "business"}
            expiresAt={activePlan === "business" ? activeExpiresAt : null}
            recommended
            loading={loadingPlan === "business"}
            subscribeLabel={activePlan === "business" && status?.isExpired ? "ต่ออายุ ฿99" : undefined}
            onSubscribe={() => handleSubscribe("business")}
          />
        )}
      </div>
    </div>
  );
}
