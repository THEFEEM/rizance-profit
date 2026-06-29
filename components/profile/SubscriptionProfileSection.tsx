"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { PLAN_DISPLAY_NAMES } from "@/lib/subscription-plan";
import type { SubscriptionPlan } from "@/lib/subscription-plan";

type TokenBudgetSummary = {
  used: number;
  total: number;
  remaining: number;
  creditsRemaining: {
    rizq_chat: number;
    scan_slip: number;
    scan_receipt: number;
  };
};

type SubscriptionStatus = {
  plan: SubscriptionPlan;
  expiresAt: string | null;
  isExpired: boolean;
  tokenBudget?: TokenBudgetSummary;
};

export function SubscriptionProfileSection() {
  const router = useRouter();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<SubscriptionStatus>("/api/subscription").then((res) => {
      if (res.ok) setStatus(res.data);
    });
  }, []);

  async function handleCancel() {
    setCancelBusy(true);
    setCancelMessage(null);
    const res = await apiFetch<{ ok: true }>("/api/subscription/cancel", {
      method: "POST",
    });
    setCancelBusy(false);

    if (res.ok) {
      setCancelMessage("ตั้งค่ายกเลิกแล้ว — ใช้งานได้จนสิ้นรอบบิล");
      router.refresh();
      return;
    }

    setCancelMessage(res.message);
  }

  const plan = status?.plan ?? "free";
  const planLabel = PLAN_DISPLAY_NAMES[plan] ?? plan;
  const credits = status?.tokenBudget?.creditsRemaining;
  const statusLabel =
    status == null
      ? "กำลังโหลด..."
      : status.isExpired
        ? "หมดอายุแล้ว"
        : plan === "free"
          ? "แพ็กเกจฟรี"
          : "ใช้งานอยู่";

  return (
    <section className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
      <h2 className="border-b-[0.5px] border-rz-border px-4 py-3 text-sm font-medium text-rz-text">
        แพ็กเกจ
      </h2>
      <div className="space-y-3 px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-rz-muted">แพ็กเกจปัจจุบัน</span>
          <span className="font-medium text-rz-text">{planLabel}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-rz-muted">สถานะ</span>
          <span className="text-rz-text">{statusLabel}</span>
        </div>
        {credits && (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-rz-muted">Rizq AI</span>
              <span className="text-rz-text">ใช้ได้อีก {credits.rizq_chat} ครั้ง</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-rz-muted">สแกน</span>
              <span className="text-rz-text">ใช้ได้อีก {credits.scan_slip} ครั้ง</span>
            </div>
          </>
        )}
        {status?.expiresAt && !status.isExpired && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-rz-muted">หมดอายุ</span>
            <span className="text-rz-text">
              {new Date(status.expiresAt).toLocaleDateString("th-TH", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href="/pricing"
            className="tap-target rounded-full border border-rz-border bg-rz-elevated px-4 py-2 text-sm text-rz-text"
          >
            เปลี่ยนแพ็กเกจ
          </Link>
          {(plan === "business" || plan === "personal_plus") && !status?.isExpired && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancelBusy}
              className="tap-target rounded-full border border-rz-border px-4 py-2 text-sm text-rz-muted disabled:opacity-50"
            >
              {cancelBusy ? "กำลังยกเลิก..." : "ยกเลิก"}
            </button>
          )}
        </div>

        {cancelMessage && (
          <p className="text-xs text-rz-muted" role="status">
            {cancelMessage}
          </p>
        )}
      </div>
    </section>
  );
}
