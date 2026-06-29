"use client";

import { Check, X } from "lucide-react";

export type PricingFeature = {
  label: string;
  included: boolean;
};

export function PricingCard({
  name,
  price,
  period,
  features,
  footnote,
  isActive = false,
  expiresAt,
  onSubscribe,
  loading = false,
  recommended = false,
  subscribeLabel,
}: {
  name: string;
  price: string;
  period: string;
  features: PricingFeature[];
  footnote?: string;
  isActive?: boolean;
  expiresAt?: string | null;
  onSubscribe?: () => void;
  loading?: boolean;
  recommended?: boolean;
  subscribeLabel?: string;
}) {
  const showSubscribe = Boolean(onSubscribe) && !isActive;
  const buttonLabel =
    subscribeLabel ?? (isActive ? "ใช้งานอยู่" : `สมัคร ${price}`);

  return (
    <article
      className={`flex h-full flex-col rounded-[16px] border bg-rz-card p-4 ${
        recommended ? "border-2 border-rz-green" : "border-[0.5px] border-rz-border"
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-rz-text">{name}</h3>
          <p className="mt-1 text-2xl font-bold text-rz-text">
            {price}
            <span className="ml-1 text-sm font-normal text-rz-muted">/ {period}</span>
          </p>
        </div>
        {isActive && (
          <span className="shrink-0 rounded-full bg-rz-green/15 px-2.5 py-1 text-xs font-medium text-rz-green">
            ใช้งานอยู่
          </span>
        )}
      </div>

      {isActive && expiresAt && (
        <p className="mb-3 text-xs text-rz-muted">
          หมดอายุ {new Date(expiresAt).toLocaleDateString("th-TH", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </p>
      )}

      <ul className="mb-4 flex-1 space-y-2">
        {features.map((feature) => (
          <li key={feature.label} className="flex items-start gap-2 text-sm">
            {feature.included ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-rz-green" strokeWidth={2.5} />
            ) : (
              <X className="mt-0.5 h-4 w-4 shrink-0 text-rz-hint" strokeWidth={2.5} />
            )}
            <span className={feature.included ? "text-rz-text" : "text-rz-hint"}>
              {feature.label}
            </span>
          </li>
        ))}
      </ul>

      {footnote && <p className="mb-4 text-xs leading-5 text-rz-hint">{footnote}</p>}

      {showSubscribe ? (
        <button
          type="button"
          onClick={onSubscribe}
          disabled={loading}
          className={`tap-target min-h-11 rounded-[12px] text-sm font-medium disabled:opacity-50 ${
            recommended
              ? "bg-rz-green text-rz-bg"
              : "border border-rz-border bg-rz-elevated text-rz-text"
          }`}
        >
          {loading ? "กำลังเปิดหน้าชำระเงิน..." : buttonLabel}
        </button>
      ) : isActive ? (
        <div className="min-h-11 rounded-[12px] border border-rz-border bg-rz-elevated px-3 py-2.5 text-center text-sm text-rz-muted">
          แพ็กเกจปัจจุบัน
        </div>
      ) : null}
    </article>
  );
}
