import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { advanceCreditorsTotal, listShopAdvanceCreditors } from "@/lib/advance-creditors";

/** Compact creditors teaser for Stats — links to full /creditors page. */
export async function ShopAdvanceCreditorsTeaser({
  userId,
  currency = "THB",
}: {
  userId: string;
  currency?: string;
}) {
  const rows = await listShopAdvanceCreditors(userId);
  if (rows.length === 0) return null;

  const total = advanceCreditorsTotal(rows);

  return (
    <section className="mt-4 px-4">
      <Link
        href="/creditors"
        className="tap-target flex items-center justify-between gap-3 rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3.5 active:bg-rz-elevated"
      >
        <div>
          <p className="text-sm font-medium text-rz-text">เงินออกก่อน / เจ้าหนี้</p>
          <p className="mt-0.5 text-xs text-rz-hint">
            {rows.length} รายชื่อ · ดูรายละเอียด →
          </p>
        </div>
        <span className="shrink-0 text-sm font-medium rz-tabular text-rz-red">
          {formatMoney(total, currency)}
        </span>
      </Link>
    </section>
  );
}
