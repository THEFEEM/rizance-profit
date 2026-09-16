import Link from "next/link";

/**
 * โครงหน้าเอกสารกฎหมาย (นโยบายความเป็นส่วนตัว · ข้อกำหนดการใช้งาน)
 *
 * เป็น server component ล้วน ไม่มี state — หน้าเหล่านี้ต้องเปิดได้โดยไม่ต้องล็อกอิน
 * (Google Play ต้องเข้าถึง URL ได้จากภายนอก) จึงถูกเพิ่มใน PUBLIC_PATHS ของ middleware
 * ใช้โทเคนสีเดิมของ profit (rz-*) ไม่เพิ่ม dependency และไม่แตะ design system
 */
export function LegalPage({
  title,
  updatedAt,
  children,
}: {
  title: string;
  updatedAt: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-rz-bg">
      <header className="border-b border-rz-border px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <Link href="/" className="text-sm font-medium text-rz-text">
            ← Rizance
          </Link>
          <nav className="flex items-center gap-4 text-sm text-rz-muted">
            <Link href="/privacy" className="hover:text-rz-text">
              ความเป็นส่วนตัว
            </Link>
            <Link href="/terms" className="hover:text-rz-text">
              ข้อกำหนด
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-rz-text">{title}</h1>
        <p className="mt-1 text-sm text-rz-muted">แก้ไขล่าสุด {updatedAt}</p>
        <div className="mt-8 space-y-10">{children}</div>
      </main>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-rz-text">{title}</h2>
      <div className="space-y-3 text-sm leading-7 text-rz-muted [&_strong]:text-rz-text">
        {children}
      </div>
    </section>
  );
}

/** ตารางอ่านง่ายบนมือถือ — เลื่อนแนวนอนได้เมื่อจอแคบ */
export function LegalTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-rz-border">
            {head.map((h) => (
              <th key={h} className="py-2 pr-4 font-medium text-rz-text">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className="border-b border-rz-border/60 align-top">
              {row.map((cell, i) => (
                <td
                  key={i}
                  className={i === 0 ? "py-2 pr-4 text-rz-text" : "py-2 pr-4 leading-6"}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
