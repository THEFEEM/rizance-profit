"use client";

import { EntryOptionButton } from "@/components/entry/EntryOptionButton";
import { formatMoney } from "@/lib/money";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
} from "@/types/booth";

export function CreditorRepaymentPaymentToggle({
  paymentMethod,
  onChange,
  selectedOnHand,
  currency = "THB",
}: {
  paymentMethod: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
  selectedOnHand: string;
  currency?: string;
}) {
  return (
    <div className="mb-1">
      <p className="mb-1.5 text-xs text-rz-muted">จ่ายด้วย</p>
      <div className="flex flex-wrap gap-2">
        {PAYMENT_METHODS.map((method) => (
          <EntryOptionButton
            key={method}
            selected={paymentMethod === method}
            onClick={() => onChange(method)}
            accent="green"
          >
            {PAYMENT_METHOD_LABELS[method]}
          </EntryOptionButton>
        ))}
      </div>
      <p className="rz-tabular mt-2 text-xs text-rz-hint">
        {PAYMENT_METHOD_LABELS[paymentMethod]}คงเหลือ {formatMoney(selectedOnHand, currency)}
      </p>
    </div>
  );
}
