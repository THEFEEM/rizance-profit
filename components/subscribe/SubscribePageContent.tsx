"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api-client";
import {
  SUBSCRIPTION_PLANS,
  type PaidSubscriptionTier,
  type SubscriptionCycle,
  type SubscriptionPlan,
} from "@/lib/pricing";

type ChargeResult = {
  chargeId: string;
  qrImageUrl: string;
  amount: number;
  tier: PaidSubscriptionTier;
  periodDays: number;
  label: string;
};

type PaymentStatus = "pending" | "paid" | "failed" | "expired";

function planCycle(plan: SubscriptionPlan): SubscriptionCycle {
  return plan.periodDays === 365 ? "year" : "period";
}

function formatBaht(amount: number): string {
  return `฿${amount.toLocaleString("th-TH")}`;
}

export function SubscribePageContent() {
  const [selected, setSelected] = useState<SubscriptionPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [charge, setCharge] = useState<ChargeResult | null>(null);
  const [status, setStatus] = useState<PaymentStatus>("pending");
  const [checking, setChecking] = useState(false);

  const checkStatus = useCallback(async (chargeId: string) => {
    setChecking(true);
    const res = await apiFetch<{
      chargeId: string;
      status: PaymentStatus;
      paid: boolean;
    }>(`/api/payment/status?chargeId=${encodeURIComponent(chargeId)}`);
    setChecking(false);

    if (res.ok) {
      setStatus(res.data.status);
      return res.data.paid;
    }
    return false;
  }, []);

  useEffect(() => {
    if (!charge || status === "paid") return;

    const id = window.setInterval(() => {
      void checkStatus(charge.chargeId);
    }, 5000);

    return () => window.clearInterval(id);
  }, [charge, status, checkStatus]);

  async function startPayment() {
    if (!selected) return;

    setBusy(true);
    setError(null);
    setCharge(null);
    setStatus("pending");

    const res = await apiFetch<ChargeResult>("/api/payment/create-charge", {
      method: "POST",
      body: JSON.stringify({
        tier: selected.tier,
        cycle: planCycle(selected),
      }),
    });

    setBusy(false);

    if (res.ok) {
      setCharge(res.data);
    } else {
      setError(res.message);
    }
  }

  function reset() {
    setCharge(null);
    setError(null);
    setStatus("pending");
  }

  if (charge) {
    return (
      <section className="px-4 py-4">
        <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-[18px] py-[18px]">
          <p className="text-center text-[11px] text-rz-hint">ชำระผ่าน PromptPay</p>
          <p className="rz-tabular mt-1 text-center text-2xl font-medium text-rz-green">
            {formatBaht(charge.amount)}
          </p>
          <p className="mt-1 text-center text-sm text-rz-muted">{charge.label}</p>

          <div className="mx-auto mt-5 flex max-w-[240px] justify-center rounded-[12px] bg-white p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={charge.qrImageUrl}
              alt="PromptPay QR code"
              className="h-auto w-full max-w-[200px]"
              width={200}
              height={200}
            />
          </div>

          <p className="mt-5 text-center text-sm text-rz-text">
            สแกนด้วยแอปธนาคารเพื่อชำระ
          </p>

          <p className="mt-3 text-center text-sm text-rz-muted">
            {status === "paid" ? (
              <span className="text-rz-green">✓ ชำระเงินสำเร็จ</span>
            ) : status === "expired" ? (
              <span className="text-rz-amber">QR หมดอายุ — สร้างใหม่</span>
            ) : status === "failed" ? (
              <span className="text-rz-red">ชำระไม่สำเร็จ — ลองใหม่</span>
            ) : (
              <span>⏳ รอชำระเงิน</span>
            )}
          </p>

          <div className="mt-5 space-y-2">
            <Button
              variant="secondary"
              disabled={checking}
              onClick={() => void checkStatus(charge.chargeId)}
            >
              {checking ? "กำลังเช็ค..." : "ฉันจ่ายแล้ว / เช็คสถานะ"}
            </Button>
            <Button variant="ghost" onClick={reset}>
              เลือกแพ็กเกจอื่น
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="px-4 py-4">
      <div className="mb-4">
        <h1 className="text-lg font-medium text-rz-text">อัปเกรดแพ็กเกจ</h1>
        <p className="mt-1 text-sm text-rz-hint">เลือกแพ็กเกจแล้วชำระผ่าน PromptPay</p>
      </div>

      <ul className="space-y-2">
        {SUBSCRIPTION_PLANS.map((plan) => {
          const active =
            selected?.tier === plan.tier && selected?.periodDays === plan.periodDays;
          return (
            <li key={`${plan.tier}-${plan.periodDays}`}>
              <button
                type="button"
                onClick={() => setSelected(plan)}
                className={`w-full rounded-[14px] border-[0.5px] px-[18px] py-4 text-left transition-colors ${
                  active
                    ? "border-rz-green bg-rz-logo-bg"
                    : "border-rz-border bg-rz-card active:bg-rz-elevated"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-rz-text">{plan.label}</span>
                  <span className="rz-tabular shrink-0 text-base font-medium text-rz-green">
                    {formatBaht(plan.priceBaht)}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {error && <p className="mt-3 text-center text-sm text-rz-red">{error}</p>}

      <div className="mt-5">
        <Button disabled={!selected || busy} onClick={() => void startPayment()}>
          {busy ? "กำลังสร้าง QR..." : "จ่ายผ่าน PromptPay"}
        </Button>
      </div>
    </section>
  );
}
