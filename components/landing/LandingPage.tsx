import Link from "next/link";
import Image from "next/image";
import {
  BarChart3,
  CalendarDays,
  MessageCircle,
  ScanLine,
  Smartphone,
  Sparkles,
  Store,
  Tent,
  Users,
  User,
} from "lucide-react";

const FEATURES = [
  {
    icon: Sparkles,
    title: "แชทแล้วบันทึกเลย",
    desc: "พิมพ์ \"ขายได้ 500\" Rizq บันทึกเข้าระบบทันที ไม่ต้องกรอกฟอร์ม",
  },
  {
    icon: ScanLine,
    title: "สแกนใบเสร็จแยกรายการ",
    desc: "ถ่ายรูปใบเสร็จ AI แยกทุกรายการอัตโนมัติ แก้ไขและยืนยันได้ในขั้นตอนเดียว",
  },
  {
    icon: BarChart3,
    title: "ถามกำไรได้ทันที",
    desc: "ถามว่า \"กำไรสัปดาห์นี้เท่าไหร่\" Rizq สรุปพร้อมแยกหมวดหมู่ให้เลย",
  },
  {
    icon: CalendarDays,
    title: "บูธและอีเวนต์ — ครบใน 7 วัน",
    desc: "Event Pass ฿49 — ใช้ Rizq AI ได้เต็มที่ แยกข้อมูลต่อบูธ ไม่ปนกัน",
  },
  {
    icon: Smartphone,
    title: "ใช้ได้ทุกอุปกรณ์ ไม่ต้องติดตั้ง",
    desc: "PWA เปิดบนมือถือได้เลย ข้อมูลซิงค์ทันที",
  },
] as const;

const MODES = [
  {
    icon: User,
    name: "ส่วนตัว",
    desc: "บันทึกรายรับ-รายจ่ายส่วนตัว วิเคราะห์การใช้จ่าย",
  },
  {
    icon: Store,
    name: "ร้านค้า",
    desc: "ติดตามกำไรร้าน สแกนสลิปและใบเสร็จ",
  },
  {
    icon: Tent,
    name: "บูธ",
    desc: "จัดการรายรับต่อบูธ Event Pass 7 วัน ฿49",
  },
  {
    icon: Users,
    name: "องค์กร",
    desc: "งบประมาณโครงการ รายงานองค์กร (ฟรี)",
  },
] as const;

const PLANS = [
  {
    name: "ฟรี",
    price: "฿0",
    period: "ตลอด",
    desc: "ส่วนตัว + ร้านค้า (จำกัด)",
    highlight: false,
  },
  {
    name: "Personal Plus",
    price: "฿49",
    period: "เดือน",
    desc: "ส่วนตัวเต็มรูปแบบ + AI ไม่จำกัด*",
    highlight: true,
  },
  {
    name: "Event Pass",
    price: "฿49",
    period: "7 วัน",
    desc: "บูธ + AI เต็มที่ 7 วัน",
    highlight: false,
  },
  {
    name: "Business",
    price: "฿99",
    period: "เดือน",
    desc: "ร้านค้าไม่จำกัด + AI ขั้นสูง",
    highlight: false,
  },
] as const;

function LandingHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-rz-border/80 bg-rz-bg/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-[10px] border border-rz-logo-border bg-rz-logo-bg">
            <Image src="/Logo.png" alt="Rizance" width={28} height={28} className="h-7 w-7 object-contain" priority />
          </div>
          <span className="text-base font-medium text-rz-text">Rizance</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="tap-target rounded-full px-3 py-2 text-sm text-rz-muted"
          >
            เข้าสู่ระบบ
          </Link>
          <Link
            href="/register"
            className="tap-target rounded-full bg-rz-green px-4 py-2 text-sm font-medium text-rz-bg"
          >
            เริ่มใช้ฟรี
          </Link>
        </div>
      </div>
    </header>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-dvh bg-rz-bg text-rz-text">
      <LandingHeader />

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-5xl px-4 pb-16 pt-12 text-center md:pt-16">
          <p className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-rz-border bg-rz-card px-3 py-1 text-xs text-rz-muted">
            <MessageCircle className="h-3.5 w-3.5 text-rz-green" strokeWidth={2} />
            Powered by Rizq AI
          </p>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-rz-text md:text-4xl lg:text-5xl">
            จดบัญชีด้วย AI
            <br />
            พิมพ์แค่ประโยคเดียว
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-rz-muted md:text-lg">
            Rizq AI ช่วยบันทึก วิเคราะห์ และสรุปกำไรให้อัตโนมัติ
            <br className="hidden sm:inline" />
            {" "}ไม่ต้องเปิด Excel ไม่ต้องจำสูตร
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/register"
              className="tap-target min-w-[180px] rounded-[14px] bg-rz-green px-6 py-3 text-sm font-medium text-rz-bg"
            >
              เริ่มใช้ฟรี
            </Link>
            <Link
              href="/pricing"
              className="tap-target min-w-[180px] rounded-[14px] border border-rz-border bg-rz-card px-6 py-3 text-sm font-medium text-rz-text"
            >
              ดูแพ็กเกจ
            </Link>
          </div>
        </section>

        {/* Features */}
        <section className="border-t border-rz-border bg-rz-card/40 py-14">
          <div className="mx-auto max-w-5xl px-4">
            <h2 className="text-center text-xl font-semibold text-rz-text md:text-2xl">
              Rizq ทำอะไรได้บ้าง
            </h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <article
                  key={title}
                  className="rounded-[16px] border border-rz-border bg-rz-card p-5"
                >
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[11px] border border-rz-border bg-rz-elevated text-rz-green">
                    <Icon className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <h3 className="text-base font-medium text-rz-text">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-rz-muted">{desc}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Modes */}
        <section className="py-14">
          <div className="mx-auto max-w-5xl px-4">
            <h2 className="text-center text-xl font-semibold text-rz-text md:text-2xl">
              เลือกโหมดที่เหมาะกับคุณ
            </h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {MODES.map(({ icon: Icon, name, desc }) => (
                <article
                  key={name}
                  className="rounded-[16px] border border-rz-border bg-rz-card p-4 text-center"
                >
                  <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-rz-border bg-rz-elevated text-rz-blue">
                    <Icon className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <h3 className="font-medium text-rz-text">{name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-rz-muted">{desc}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing preview */}
        <section className="border-t border-rz-border bg-rz-card/40 py-14">
          <div className="mx-auto max-w-5xl px-4">
            <h2 className="text-center text-xl font-semibold text-rz-text md:text-2xl">
              ราคาที่เหมาะกับทุกขนาด
            </h2>
            <p className="mt-2 text-center text-sm text-rz-muted">เริ่มต้นฟรี อัพเกรดเมื่อพร้อม</p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PLANS.map((plan) => (
                <article
                  key={plan.name}
                  className={`flex flex-col rounded-[16px] border p-4 ${
                    plan.highlight
                      ? "border-2 border-rz-green bg-rz-card"
                      : "border-rz-border bg-rz-card"
                  }`}
                >
                  <h3 className="font-medium text-rz-text">{plan.name}</h3>
                  <p className="mt-2 text-2xl font-bold text-rz-text">
                    {plan.price}
                    <span className="ml-1 text-sm font-normal text-rz-muted">/ {plan.period}</span>
                  </p>
                  <p className="mt-3 flex-1 text-sm text-rz-muted">{plan.desc}</p>
                </article>
              ))}
            </div>
            <p className="mt-4 text-center text-xs text-rz-hint">
              *ใช้ได้ตาม Fair Usage — ประมาณ 100 ครั้ง/เดือน
            </p>
            <p className="mt-4 text-center">
              <Link href="/pricing" className="text-sm font-medium text-rz-green">
                ดูรายละเอียดทั้งหมด →
              </Link>
            </p>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="py-16">
          <div className="mx-auto max-w-2xl px-4 text-center">
            <h2 className="text-2xl font-semibold text-rz-text">เริ่มต้นฟรี — ไม่ต้องผูกบัตร</h2>
            <p className="mt-3 text-sm text-rz-muted">
              สมัครใช้งานใน 30 วินาที ด้วย Google หรืออีเมล
            </p>
            <Link
              href="/register"
              className="tap-target mt-8 inline-flex min-h-11 items-center justify-center rounded-[14px] bg-rz-green px-8 text-sm font-medium text-rz-bg"
            >
              สมัครฟรีเลย
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-rz-border py-6 text-center text-xs text-rz-hint">
        © {new Date().getFullYear()} Rizance
      </footer>
    </div>
  );
}
