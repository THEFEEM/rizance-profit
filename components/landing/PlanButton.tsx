"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

type PlanButtonProps = {
  planKey: string;
  isLoggedIn: boolean;
  className: string;
  children: React.ReactNode;
};

export function PlanButton({ planKey, isLoggedIn, className, children }: PlanButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSelectPlan() {
    setError(null);

    // Free plan never touches Stripe.
    if (planKey === "free") {
      router.push(isLoggedIn ? "/home" : "/register");
      return;
    }

    // Must be signed in before creating a checkout session.
    if (!isLoggedIn) {
      router.push(`/register?redirect=checkout&plan=${planKey}`);
      return;
    }

    setLoading(true);
    const res = await apiFetch<{ url: string }>("/api/checkout", {
      method: "POST",
      body: JSON.stringify({ plan: planKey }),
    });
    setLoading(false);

    if (res.ok && res.data?.url) {
      window.location.href = res.data.url;
      return;
    }
    setError(res.ok ? "ไม่สามารถเปิดหน้าชำระเงินได้" : res.message);
  }

  return (
    <>
      <button type="button" onClick={handleSelectPlan} disabled={loading} className={`${className} disabled:opacity-60`}>
        {loading ? "กำลังโหลด…" : children}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-center text-[12px] text-[var(--rz-red)]">
          {error}
        </p>
      )}
    </>
  );
}
