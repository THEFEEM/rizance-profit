import { formatMoney } from "@/lib/money";
import { formatDayShort } from "@/lib/date";
import type { SavingsTransaction } from "@/types/personal";

export function SavingsActivitySection({
  transactions,
  currency = "THB",
}: {
  transactions: SavingsTransaction[];
  currency?: string;
}) {
  if (transactions.length === 0) return null;

  return (
    <section className="mt-4 px-4">
      <h2 className="mb-2 text-sm font-medium text-rz-text">เงินออมมาจากไหน</h2>
      <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
        <ul className="divide-y divide-rz-border/60">
          {transactions.map((tx) => {
            const isDeposit = tx.kind === "deposit";
            return (
              <li key={tx.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-rz-text">
                    {isDeposit ? "ออมเงิน" : "ถอนเงินออม"} · {tx.goalName}
                  </p>
                  <p className="text-xs text-rz-hint">
                    {formatDayShort(tx.entryDate)}
                    {tx.note ? ` · ${tx.note}` : ""}
                  </p>
                </div>
                <p
                  className={`shrink-0 text-sm font-medium rz-tabular ${
                    isDeposit ? "text-rz-red" : "text-rz-green"
                  }`}
                >
                  {isDeposit ? "−" : "+"}
                  {formatMoney(tx.amount, currency)}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
