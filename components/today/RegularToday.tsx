import {
  monthToDateSummary,
  dailySummary,
  listIncomeByDate,
  listExpenseByDate,
} from "@/lib/queries";
import { today } from "@/lib/date";
import { computeShopOnHand } from "@/lib/shop-on-hand";
import { shopMemberProfitWithdrawable } from "@/lib/shop-profit-withdrawable";
import { shopSplitProfit } from "@/lib/shop-split";
import { TodayBalanceCard } from "@/components/TodayBalanceCard";
import { TodayStatCards } from "@/components/TodayStatCards";
import { TodayCategoryMiniList } from "@/components/today/TodayCategoryMiniList";
import { EntryList, type EntryRow } from "@/components/EntryList";
import { SplitProfitCard } from "@/components/shared/SplitProfitCard";
import { ShopProfitWithdrawalSection } from "@/components/shop/ShopProfitWithdrawalSection";
import { ShopPosLaunchCard } from "@/components/shop/ShopPosLaunchCard";
import { ViewFullSummaryButton } from "@/components/shared/ViewFullSummaryButton";
import { buildTodayCategoryGroups } from "@/lib/today-category-groups";
import { getPublicPosAppUrl } from "@/lib/env";
import { getActiveSubscriptionPlan } from "@/lib/subscription-user";
import type { User } from "@/types";
import type { PaymentMethod } from "@/types/booth";

/** Regular-shop Today — total sales hero + today's breakdown + partner split. */
export async function RegularToday({ user }: { user: User }) {
  const date = today();
  const [monthly, summary, incomes, expenses, onHand, split, shopWithdrawals, activePlan] =
    await Promise.all([
    monthToDateSummary(user.id),
    dailySummary(user.id, date),
    listIncomeByDate(user.id, date),
    listExpenseByDate(user.id, date),
    computeShopOnHand(user.id),
    shopSplitProfit(user.id, date, date),
    shopMemberProfitWithdrawable(user.id),
    getActiveSubscriptionPlan(user.id),
  ]);

  const { cashOnHand, transferOnHand, totalOnHand } = onHand;

  const entries: EntryRow[] = [
    ...incomes.map((i) => ({
      id: i.id,
      kind: "income" as const,
      amount: i.amount,
      note: i.note,
      category: i.category,
      paymentMethod: i.paymentMethod as PaymentMethod | undefined,
      createdAt: i.createdAt,
      // บิล POS ที่ยกเลิก — โชว์ขีดฆ่าพร้อมป้าย ไม่นับยอด (สอดคล้อง summary ที่กรองแล้ว)
      voided: i.voidedAt != null,
    })),
    ...expenses.map((e) => ({
      id: e.id,
      kind: "expense" as const,
      amount: e.amount,
      note: e.note,
      category: e.category,
      paymentMethod: (e.paymentMethod ?? "cash") as PaymentMethod,
      createdAt: e.createdAt,
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const categoryGroups = buildTodayCategoryGroups(entries);
  const hasEntries = entries.length > 0;

  return (
    <>
      <TodayBalanceCard
        totalSales={monthly.income}
        cumulativeProfit={monthly.profit}
        totalOnHand={totalOnHand}
        cashOnHand={cashOnHand}
        transferOnHand={transferOnHand}
        currency={user.currency}
        salesLabel="ยอดขายเดือนนี้"
        profitLabel="กำไรเดือนนี้"
      />

      <TodayStatCards
        income={summary.income}
        expense={summary.expense}
        currency={user.currency}
      />

      <ShopPosLaunchCard plan={activePlan} posAppUrl={getPublicPosAppUrl()} />

      {split && (
        <SplitProfitCard
          split={split}
          currency={user.currency}
          accent="green"
          periodLabel="ทั้งหมด"
          variant="compact"
          shopWithdrawals={shopWithdrawals}
        />
      )}

      <ShopProfitWithdrawalSection
        userId={user.id}
        currency={user.currency}
        variant="compact"
        onHand={onHand}
        members={shopWithdrawals}
      />

      {hasEntries && (
        <TodayCategoryMiniList groups={categoryGroups} currency={user.currency} />
      )}

      <div className="mt-3 px-4">
        {hasEntries ? (
          <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
            <EntryList
              entries={entries}
              currency={user.currency}
              appearance="today"
              emptyHint="ยังไม่มีรายการวันนี้ — แตะ +In หรือ −Out เพื่อเริ่ม"
            />
          </div>
        ) : (
          <p className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-6 text-center text-[13px] text-rz-hint">
            ยังไม่มีรายการวันนี้ — แตะ +In หรือ −Out เพื่อเริ่ม
          </p>
        )}
      </div>

      <ViewFullSummaryButton href="/summary" accent="green" className="mt-4 pb-2" />
    </>
  );
}
