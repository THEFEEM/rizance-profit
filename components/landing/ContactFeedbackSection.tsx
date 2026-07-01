import { Mail, Phone } from "lucide-react";
import { FeedbackForm } from "./FeedbackForm";

/* Scoped styles preserved verbatim so the existing (working) FeedbackForm +
   contact card keep their original look. Do not restyle FeedbackForm. */
const CSS = `
.lp-contact{--card:#16203A;--inset:#1A2236;--border:#243049;--text:#E8EDF5;--muted:#9AA6B8;--hint:#5C6679;--green:#4ADE9E;--green-deep:#1D9E75;color:var(--text);line-height:1.6}
.lp-contact *{margin:0;padding:0;box-sizing:border-box}
.lp-contact .wrap{max-width:1120px;margin:0 auto;padding:0 24px}
.lp-contact .sec-eyebrow{font-size:13px;font-weight:600;color:#EF9F27;letter-spacing:.04em;text-transform:uppercase;margin-bottom:14px}
.lp-contact .sec-title{font-size:clamp(26px,3.5vw,36px);font-weight:700;margin-bottom:16px;letter-spacing:-.02em;line-height:1.2}
.lp-contact .sec-lead{font-size:17px;color:var(--muted);max-width:600px;margin-bottom:44px}
.lp-contact .btn{display:inline-flex;align-items:center;gap:8px;border:none;border-radius:11px;font-weight:600;cursor:pointer;transition:transform .15s,box-shadow .2s;font-size:15px}
.lp-contact .btn-green{background:var(--green-deep);color:#fff;padding:12px 20px}
.lp-contact .fb-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}
@media(max-width:820px){.lp-contact .fb-grid{grid-template-columns:1fr}}
.lp-contact .fb-card{background:var(--card);border:.5px solid var(--border);border-radius:18px;padding:28px}
.lp-contact .fb-card h3{font-size:20px;margin-bottom:6px;font-weight:600;letter-spacing:-.02em;line-height:1.2}
.lp-contact .fb-sub{font-size:14px;color:var(--muted);margin-bottom:22px}
.lp-contact .fb-label{display:block;font-size:13px;color:var(--muted);margin-bottom:8px;margin-top:18px}
.lp-contact .fb-label:first-of-type{margin-top:0}
.lp-contact .fb-input,.lp-contact .fb-textarea{width:100%;background:var(--inset);border:.5px solid var(--border);border-radius:11px;color:var(--text);font-size:15px;padding:12px 14px;font-family:inherit;outline:none;transition:border-color .2s}
.lp-contact .fb-input:focus,.lp-contact .fb-textarea:focus{border-color:var(--green)}
.lp-contact .fb-input::placeholder,.lp-contact .fb-textarea::placeholder{color:var(--hint)}
.lp-contact .fb-textarea{min-height:120px;resize:vertical;line-height:1.6}
.lp-contact .fb-stars{display:flex;gap:8px}
.lp-contact .fb-star{background:none;border:none;cursor:pointer;font-size:28px;line-height:1;color:var(--border);padding:0;transition:color .15s,transform .15s}
.lp-contact .fb-star:hover{transform:scale(1.12)}
.lp-contact .fb-star.on{color:#EF9F27}
.lp-contact .fb-submit{width:100%;justify-content:center;margin-top:26px;padding:14px}
.lp-contact .contact-row{display:flex;align-items:center;gap:14px;background:var(--inset);border:.5px solid var(--border);border-radius:14px;padding:16px;margin-bottom:14px;transition:border-color .2s;text-decoration:none;color:inherit}
.lp-contact .contact-row:hover{border-color:var(--green)}
.lp-contact .contact-ic{width:42px;height:42px;border-radius:11px;display:grid;place-items:center;flex-shrink:0;background:#15293F;border:.5px solid #1E3A52}
.lp-contact .contact-ic.g{background:#16352A;border:.5px solid #1D5B43}
.lp-contact .contact-txt{display:flex;flex-direction:column;gap:2px;font-size:15px;min-width:0}
.lp-contact .contact-txt small{font-size:12px;color:var(--hint)}
.lp-contact .contact-txt b{font-weight:600;color:var(--text);word-break:break-all}
.lp-contact .contact-note{font-size:13px;color:var(--muted);margin-top:6px;line-height:1.6}
`;

export function ContactFeedbackSection() {
  return (
    <section
      id="contact"
      className="lp-contact relative z-10 border-y border-[var(--rz-border)] py-[96px] max-md:py-[48px]"
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wrap">
        <div className="sec-eyebrow" style={{ textAlign: "center" }}>เสียงของคุณสำคัญ</div>
        <h2 className="sec-title" style={{ marginLeft: "auto", marginRight: "auto", textAlign: "center" }}>
          ฟีดแบ็ก &amp; ติดต่อสอบถาม
        </h2>
        <p className="sec-lead" style={{ marginLeft: "auto", marginRight: "auto", textAlign: "center" }}>
          อยากให้ Rizance ดีขึ้นตรงไหน หรือมีคำถาม บอกเราได้เลย
        </p>
        <div className="fb-grid">
          <FeedbackForm />
          <div className="fb-card">
            <h3>ติดต่อสอบถาม</h3>
            <p className="fb-sub">มีคำถามเรื่องการใช้งาน ราคา หรือสนใจแพ็กเทีม ทักได้เลย</p>
            <a className="contact-row" href="mailto:lutfee7890@gmail.com">
              <span className="contact-ic"><Mail size={20} color="#6BB6FF" strokeWidth={2} /></span>
              <span className="contact-txt"><small>อีเมล</small><b>lutfee7890@gmail.com</b></span>
            </a>
            <a className="contact-row" href="tel:0967198011">
              <span className="contact-ic g"><Phone size={20} color="#4ADE9E" strokeWidth={2} /></span>
              <span className="contact-txt"><small>โทรศัพท์</small><b>096 719 8011</b></span>
            </a>
            <p className="contact-note">เราตอบกลับทุกข้อความ ปกติภายใน 1 วันทำการ — ไม่ว่าจะเป็นคำถามการใช้งาน ขอเดโม หรือปรึกษาแพ็กเกจสำหรับนิติบุคคล</p>
          </div>
        </div>
      </div>
    </section>
  );
}
