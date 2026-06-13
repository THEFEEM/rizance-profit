"use client";

import { useState } from "react";
import { RoleBadge } from "@/components/booth/summary/role-styles";
import { formatMoney, moneySign, sumDecimals } from "@/lib/money";
import { MEMBER_ROLE_LABELS, type SplitProfitResult } from "@/types/booth";

export function BoothSummaryEmployeeCards({
  split,
  currency = "THB",
}: {
  split: SplitProfitResult;
  currency?: string;
}) {
  const employees = split.memberShares.filter((s) => s.role === "employee");
  const showRemainder = moneySign(split.remainder) !== 0;

  if (employees.length === 0 && !showRemainder) return null;

  return (
    <section className="mt-6 px-4">
      <div className="grid grid-cols-2 gap-3">
        {employees.length > 0 && (
          <EmployeeCard employees={employees} currency={currency} />
        )}
        {showRemainder && (
          <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-3 py-3">
            <p className="text-xs font-medium text-rz-muted">เศษเข้ากองกลาง</p>
            <p className="mt-2 rz-tabular text-base font-medium text-rz-muted">
              {formatMoney(split.remainder, currency)}
            </p>
            <p className="mt-1 text-xs text-rz-hint">จากการปัดเศษส่วนแบ่ง</p>
          </div>
        )}
      </div>
    </section>
  );
}

function EmployeeCard({
  employees,
  currency,
}: {
  employees: SplitProfitResult["memberShares"];
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const totalWageStr = sumDecimals(0, ...employees.map((e) => e.wageCost));
  const multi = employees.length > 1;

  return (
    <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-3 py-3">
      <RoleBadge role="employee" label={MEMBER_ROLE_LABELS.employee} />
      {multi && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="tap-target mt-2 w-full text-left"
        >
          <p className="text-sm font-medium text-rz-text">
            พนักงาน {employees.length} คน
          </p>
          <p className="mt-1 rz-tabular text-sm font-medium text-rz-red">
            ค่าแรง {formatMoney(totalWageStr, currency)}
          </p>
          <p className="mt-1 text-xs text-rz-hint">ไม่ได้ส่วนแบ่งกำไร · แตะดูรายชื่อ</p>
        </button>
      ) : (
        <div className="mt-2 space-y-2">
          {employees.map((s) => (
            <div key={s.memberId}>
              <p className="text-sm font-medium text-rz-text">{s.name}</p>
              <p className="rz-tabular text-sm font-medium text-rz-red">
                ค่าแรง {formatMoney(s.wageCost, currency)}
              </p>
              {s.eventDays !== null && s.eventDays > 0 && (
                <p className="text-xs text-rz-hint">รายวัน × {s.eventDays} วัน</p>
              )}
            </div>
          ))}
          <p className="text-xs text-rz-hint">ไม่ได้ส่วนแบ่งกำไร</p>
          {multi && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-rz-hint"
            >
              ย่อ
            </button>
          )}
        </div>
      )}
    </div>
  );
}
