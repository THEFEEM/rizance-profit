import {
  personalAllTimeSummary,
  personalMonthlySummary,
  listPersonalEntriesAll,
  listSavingsGoals,
  listSavingsTransactions,
} from "@/lib/personal-queries";
import { formatMoney, moneySign } from "@/lib/money";
import { TodayStatCards } from "@/components/TodayStatCards";
import { EntryList, type EntryRow } from "@/components/EntryList";
import { PersonalBudgetBar } from "@/components/today/PersonalBudgetBar";
import { SavingsGoalsSection } from "@/components/today/SavingsGoalsSection";
import { SavingsActivitySection } from "@/components/today/SavingsActivitySection";
import { ViewFullSummaryButton } from "@/components/shared/ViewFullSummaryButton";
import type { User } from "@/types";

/** Personal-mode Today — balance hero, monthly stats, budget, recent entries, goals. */
export async function PersonalToday({ user }: { user: User }) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [allTime, monthly, entries, goals, savingsTx] = await Promise.all([
    personalAllTimeSummary(user.id),
    personalMonthlySummary(user.id, year, month),
    listPersonalEntriesAll(user.id, 10),
    listSavingsGoals(user.id),
    listSavingsTransactions(user.id, 10),
  ]);

  const entryRows: EntryRow[] = entries.map((e) => ({
    id: e.id,
    kind: e.kind,
    amount: e.amount,
    note: e.note,
    category: e.category,
    createdAt: e.createdAt,
    savingsGoalName: e.savingsGoalName ?? undefined,
  }));

  const walletBalance = allTime.walletBalance;
  const balanceSign = moneySign(walletBalance);
  const balanceColor =
    balanceSign > 0 ? "text-rz-green" : balanceSign < 0 ? "text-rz-red" : "text-rz-hint";

  return (
    <>
      <section className="px-4 pt-3">
        <div className="rounded-[14px] border-[0.5px] border-rz-rose/30 bg-rz-card px-[18px] py-[18px]">
          <p className="text-[11px] text-rz-hint">เงินคงเหลือ</p>
          <p className={`rz-tabular mt-1 break-all text-[32px] font-medium leading-tight tracking-[-0.5px] ${balanceColor}`}>
            {formatMoney(walletBalance, user.currency)}
          </p>
          <p className={`mt-1 text-xs ${balanceColor}`}>
            รายรับ {formatMoney(allTime.income, user.currency)} · รายจ่าย{" "}
            {formatMoney(allTime.expense, user.currency)}
          </p>
          <p className="mt-0.5 text-[10px] text-rz-hint">
            (ไม่รวมออม/ถอน — นับแยกในเป้าหมายออม)
          </p>
        </div>
      </section>

      <TodayStatCards
        income={monthly.income}
        expense={monthly.expense}
        incomeLabel="รายรับเดือนนี้"
        expenseLabel="รายจ่ายเดือนนี้"
        currency={user.currency}
      />

      <PersonalBudgetBar
        monthlyBudget={user.monthlyBudget}
        monthExpense={monthly.expense}
        currency={user.currency}
      />

      <section className="mt-4 px-4">
        <h2 className="mb-2 text-sm font-medium text-rz-text">รายการล่าสุด</h2>
        {entryRows.length > 0 ? (
          <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
            <EntryList
              entries={entryRows}
              currency={user.currency}
              appearance="today"
              ledger="personal"
              readOnly
              emptyHint="ยังไม่มีรายการ — แตะ + เพื่อบันทึก"
            />
          </div>
        ) : (
          <p className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-6 text-center text-[13px] text-rz-hint">
            ยังไม่มีรายการ — แตะ + เพื่อบันทึก
          </p>
        )}
      </section>

      <SavingsGoalsSection goals={goals} currency={user.currency} />
      <SavingsActivitySection transactions={savingsTx} currency={user.currency} />

      <ViewFullSummaryButton href="/personal/summary" accent="rose" className="mt-4 pb-2" />
    </>
  );
}
