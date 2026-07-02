import { Reveal } from "./shared/Reveal";
import { Counter } from "./shared/Counter";
import { sectionPad, wrap } from "./shared/ui";

const STAT_CARD =
  "rounded-2xl border border-[var(--rz-border)] bg-[var(--rz-card)] px-6 py-8 text-center";
const STAT_NUM = "mb-2 text-[38px] font-semibold text-[var(--rz-green)]";

export function StatsRow() {
  return (
    <section className={`${sectionPad} pt-0`}>
      <div className={wrap}>
        <Reveal>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Counter target={4} label="โหมดที่รองรับ" className={STAT_CARD} numClassName={STAT_NUM} />
            <Counter
              target={3}
              suffix=" วิ"
              label="เวลาบันทึกต่อรายการ"
              className={STAT_CARD}
              numClassName={STAT_NUM}
            />
            <Counter
              target={24}
              suffix=" ชม."
              label="พร้อมใช้งานทุกวัน"
              className={STAT_CARD}
              numClassName={STAT_NUM}
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
