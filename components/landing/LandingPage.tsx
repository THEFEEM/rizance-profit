import Link from "next/link";

const CSS = `
.lp{--bg:#0E1525;--card:#16203A;--inset:#1A2236;--border:#243049;--text:#E8EDF5;--muted:#9AA6B8;--hint:#5C6679;--green:#4ADE9E;--green-deep:#1D9E75;--blue:#6BB6FF;--amber:#EF9F27;--purple:#B69CE8;background:var(--bg);color:var(--text);line-height:1.6}
.lp *{margin:0;padding:0;box-sizing:border-box}
.lp .wrap{max-width:1120px;margin:0 auto;padding:0 24px}
.lp h1,.lp h2,.lp h3{font-weight:600;letter-spacing:-0.02em;line-height:1.2}
.lp a{color:inherit;text-decoration:none}
.lp nav{position:sticky;top:0;z-index:50;background:rgba(14,21,37,.82);backdrop-filter:blur(12px);border-bottom:.5px solid var(--border)}
.lp .nav-in{display:flex;align-items:center;justify-content:space-between;height:64px}
.lp .logo{display:flex;align-items:center;gap:10px;font-weight:600;font-size:19px}
.lp .logo-mark{width:34px;height:34px;border-radius:10px;overflow:hidden;display:grid;place-items:center;background:#16352A;border:.5px solid #1D5B43;color:var(--green);font-weight:700}
.lp .nav-links{display:flex;gap:28px;align-items:center}
.lp .nav-links a{color:var(--muted);font-size:14px;transition:color .2s}
.lp .nav-links a:hover{color:var(--text)}
.lp .btn{display:inline-flex;align-items:center;gap:8px;border:none;border-radius:11px;font-weight:600;cursor:pointer;transition:transform .15s,box-shadow .2s;font-size:15px}
.lp .btn-green{background:var(--green-deep);color:#fff;padding:12px 20px}
.lp .btn-ghost{background:var(--card);color:var(--text);border:.5px solid var(--border);padding:12px 20px}
.lp .nav .btn{padding:9px 16px;font-size:14px}
@media(max-width:720px){.lp .nav-links a:not(.btn){display:none}}
.lp .hero{padding:72px 0 40px}
.lp .eyebrow{display:inline-flex;align-items:center;gap:8px;background:var(--inset);border:.5px solid var(--border);color:var(--amber);font-size:13px;font-weight:500;padding:6px 13px;border-radius:99px;margin-bottom:22px}
.lp .eyebrow .dot{width:6px;height:6px;border-radius:50%;background:var(--amber)}
.lp h1.hero-title{font-size:clamp(32px,5vw,52px);font-weight:700;margin-bottom:20px;max-width:760px}
.lp h1.hero-title .hl{color:var(--green)}
.lp .hero-sub{font-size:18px;color:var(--muted);margin-bottom:30px;max-width:560px}
.lp .hero-cta{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.lp .hero-note{font-size:13px;color:var(--hint);display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.lp section{padding:78px 0}
.lp .sec-eyebrow{font-size:13px;font-weight:600;color:var(--amber);letter-spacing:.04em;text-transform:uppercase;margin-bottom:14px}
.lp .sec-title{font-size:clamp(26px,3.5vw,36px);font-weight:700;margin-bottom:16px;max-width:680px}
.lp .sec-lead{font-size:17px;color:var(--muted);max-width:600px;margin-bottom:44px}
.lp .feat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
@media(max-width:820px){.lp .feat-grid{grid-template-columns:1fr}}
.lp .fcard{background:var(--card);border:.5px solid var(--border);border-radius:16px;padding:24px;transition:transform .2s,border-color .2s}
.lp .fcard:hover{transform:translateY(-3px);border-color:var(--green)}
.lp .fcard .ic{width:42px;height:42px;border-radius:11px;display:grid;place-items:center;margin-bottom:15px;font-size:20px}
.lp .fcard h3{font-size:17px;margin-bottom:7px}
.lp .fcard p{font-size:14px;color:var(--muted)}
.lp .ic.g{background:#16352A;border:.5px solid #1D5B43}.lp .ic.b{background:#15293F;border:.5px solid #1E3A52}.lp .ic.a{background:#2E2310;border:.5px solid #5A3F12}.lp .ic.p{background:#241F2E;border:.5px solid #3D3352}
.lp .aud-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
@media(max-width:720px){.lp .aud-grid{grid-template-columns:1fr}}
.lp .aud{display:flex;gap:14px;align-items:flex-start;background:var(--card);border:.5px solid var(--border);border-radius:14px;padding:20px}
.lp .aud .ic{font-size:24px;flex-shrink:0}
.lp .aud h3{font-size:16px;margin-bottom:4px}
.lp .aud p{font-size:13px;color:var(--muted)}
.lp .price-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;align-items:stretch}
@media(max-width:900px){.lp .price-grid{grid-template-columns:1fr 1fr}}
@media(max-width:560px){.lp .price-grid{grid-template-columns:1fr;max-width:420px;margin:0 auto}}
.lp .price{background:var(--card);border:.5px solid var(--border);border-radius:18px;padding:24px;display:flex;flex-direction:column}
.lp .price.feat{border-color:var(--green);box-shadow:0 0 0 1px var(--green),0 20px 50px -20px rgba(74,222,158,.2);position:relative}
.lp .price.feat .tagp{position:absolute;top:-11px;left:50%;transform:translateX(-50%);background:var(--green-deep);color:#fff;font-size:11px;font-weight:600;padding:4px 12px;border-radius:99px}
.lp .price .pname{font-size:18px;font-weight:600;margin-bottom:6px}
.lp .price .pdesc{font-size:13px;color:var(--muted);margin-bottom:18px;min-height:38px}
.lp .price .pamt{font-size:32px;font-weight:700;letter-spacing:-.02em}
.lp .price .pamt small{font-size:14px;color:var(--hint);font-weight:400}
.lp .price-note{font-size:13px;color:var(--hint);text-align:center;margin-top:18px}
.lp .price-link{text-align:center;margin-top:14px}
.lp .price-link a{color:var(--green);font-size:15px;font-weight:600}
.lp .final{text-align:center;background:linear-gradient(160deg,#16352A22,#0B111E);border-top:.5px solid var(--border)}
.lp .final h2{font-size:clamp(28px,4vw,42px);font-weight:700;margin-bottom:16px}
.lp .final p{font-size:18px;color:var(--muted);max-width:520px;margin:0 auto 30px}
.lp .final .hero-cta{justify-content:center}
.lp footer{border-top:.5px solid var(--border);padding:40px 0 50px}
.lp .foot-in{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:18px}
.lp .foot-in .muted{font-size:13px;color:var(--hint)}
`;

export function LandingPage() {
  return (
    <div className="lp">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <nav>
        <div className="wrap nav-in">
          <Link href="/" className="logo">
            <span className="logo-mark">R</span>Rizance
          </Link>
          <div className="nav-links">
            <a href="#features">ฟีเจอร์</a>
            <a href="#modes">โหมด</a>
            <a href="#pricing">ราคา</a>
            <Link href="/register" className="btn btn-green">เริ่มใช้ฟรี</Link>
          </div>
        </div>
      </nav>

      <header className="hero">
        <div className="wrap">
          <span className="eyebrow"><span className="dot" />Powered by Rizq AI</span>
          <h1 className="hero-title">
            จดบัญชีด้วย AI <span className="hl">พิมพ์แค่ประโยคเดียว</span>
          </h1>
          <p className="hero-sub">
            Rizq AI ช่วยบันทึก วิเคราะห์ และสรุปกำไรให้อัตโนมัติ ไม่ต้องเปิด Excel ไม่ต้องจำสูตร
          </p>
          <div className="hero-cta">
            <Link href="/register" className="btn btn-green">เริ่มใช้ฟรี</Link>
            <Link href="/pricing" className="btn btn-ghost">ดูแพ็กเกจ</Link>
          </div>
          <p className="hero-note">✓ ใช้ได้ทั้งร้าน บูธ และส่วนตัว · ✓ ภาษาไทย · ✓ บนมือถือ</p>
        </div>
      </header>

      <section id="features">
        <div className="wrap">
          <div className="sec-eyebrow">ครบในแอปเดียว</div>
          <h2 className="sec-title">Rizq ทำอะไรได้บ้าง</h2>
          <p className="sec-lead">
            ผู้ช่วย AI ที่บันทึก สแกน และสรุปกำไรให้ — ออกแบบมาเพื่อคนทำธุรกิจจริง ไม่ใช่นักบัญชี
          </p>
          <div className="feat-grid">
            <div className="fcard"><div className="ic g">💬</div><h3>แชทแล้วบันทึกเลย</h3><p>พิมพ์ &quot;ขายได้ 500&quot; Rizq บันทึกเข้าระบบทันที ไม่ต้องกรอกฟอร์ม</p></div>
            <div className="fcard"><div className="ic b">📷</div><h3>สแกนใบเสร็จแยกรายการ</h3><p>ถ่ายรูปใบเสร็จ AI แยกทุกรายการอัตโนมัติ แก้ไขและยืนยันได้ในขั้นตอนเดียว</p></div>
            <div className="fcard"><div className="ic a">📊</div><h3>ถามกำไรได้ทันที</h3><p>ถามว่า &quot;กำไรสัปดาห์นี้เท่าไหร่&quot; Rizq สรุปพร้อมแยกหมวดหมู่ให้เลย</p></div>
            <div className="fcard"><div className="ic g">🎪</div><h3>บูธและอีเวนต์ — ครบใน 7 วัน</h3><p>Event Pass ฿49 — ใช้ Rizq AI ได้เต็มที่ แยกข้อมูลต่อบูธ ไม่ปนกัน</p></div>
            <div className="fcard"><div className="ic p">📱</div><h3>ใช้ได้ทุกอุปกรณ์ ไม่ต้องติดตั้ง</h3><p>PWA เปิดบนมือถือได้เลย ข้อมูลซิงค์ทันที</p></div>
          </div>
        </div>
      </section>

      <section id="modes" style={{ background: "linear-gradient(160deg,#111A2E,#0B111E)", borderTop: ".5px solid #243049", borderBottom: ".5px solid #243049" }}>
        <div className="wrap">
          <div className="sec-eyebrow">เลือกได้ตามธุรกิจ</div>
          <h2 className="sec-title">เลือกโหมดที่เหมาะกับคุณ</h2>
          <p className="sec-lead">สลับโหมดได้ตามงานที่ทำ — ข้อมูลแต่ละโหมดแยกขาดจากกัน</p>
          <div className="aud-grid">
            <div className="aud"><span className="ic">👤</span><div><h3>ส่วนตัว</h3><p>บันทึกรายรับ-รายจ่ายส่วนตัว วิเคราะห์การใช้จ่าย</p></div></div>
            <div className="aud"><span className="ic">🏪</span><div><h3>ร้านค้า</h3><p>ติดตามกำไรร้าน สแกนสลิปและใบเสร็จ</p></div></div>
            <div className="aud"><span className="ic">🎪</span><div><h3>บูธ</h3><p>จัดการรายรับต่อบูธ Event Pass 7 วัน ฿49</p></div></div>
            <div className="aud"><span className="ic">🏢</span><div><h3>องค์กร</h3><p>งบประมาณโครงการ รายงานองค์กร (ฟรี)</p></div></div>
          </div>
        </div>
      </section>

      <section id="pricing">
        <div className="wrap">
          <div className="sec-eyebrow" style={{ textAlign: "center" }}>ราคา</div>
          <h2 className="sec-title" style={{ marginLeft: "auto", marginRight: "auto", textAlign: "center" }}>ราคาที่เหมาะกับทุกขนาด</h2>
          <p className="sec-lead" style={{ marginLeft: "auto", marginRight: "auto", textAlign: "center" }}>เริ่มต้นฟรี อัพเกรดเมื่อพร้อม</p>
          <div className="price-grid">
            <div className="price">
              <div className="pname">ฟรี</div>
              <div className="pdesc">ส่วนตัว + ร้านค้า (จำกัด)</div>
              <div className="pamt">฿0</div>
            </div>
            <div className="price feat">
              <span className="tagp">แนะนำ</span>
              <div className="pname">Personal Plus</div>
              <div className="pdesc">ส่วนตัวเต็มรูปแบบ + AI ไม่จำกัด*</div>
              <div className="pamt">฿49<small>/เดือน</small></div>
            </div>
            <div className="price">
              <div className="pname">Event Pass</div>
              <div className="pdesc">บูธ + AI เต็มที่ 7 วัน</div>
              <div className="pamt">฿49<small>/7 วัน</small></div>
            </div>
            <div className="price">
              <div className="pname">Business</div>
              <div className="pdesc">ร้านค้าไม่จำกัด + AI ขั้นสูง</div>
              <div className="pamt">฿99<small>/เดือน</small></div>
            </div>
          </div>
          <p className="price-note">*ใช้ได้ตาม Fair Usage — ประมาณ 100 ครั้ง/เดือน</p>
          <p className="price-link"><Link href="/pricing">ดูรายละเอียดทั้งหมด →</Link></p>
        </div>
      </section>

      <section className="final">
        <div className="wrap">
          <h2>เริ่มต้นฟรี — ไม่ต้องผูกบัตร</h2>
          <p>สมัครใช้งานใน 30 วินาที ด้วย Google หรืออีเมล</p>
          <div className="hero-cta">
            <Link href="/register" className="btn btn-green">สมัครฟรีเลย</Link>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap foot-in">
          <Link href="/" className="logo"><span className="logo-mark">R</span>Rizance</Link>
          <span className="muted">© {new Date().getFullYear()} Rizance</span>
        </div>
      </footer>
    </div>
  );
}
