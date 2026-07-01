import { FeedbackForm } from "./FeedbackForm";
import { ContactCard } from "./ContactCard";
import { Reveal } from "./shared/Reveal";
import { eyebrowSm, sectionSub, sectionTitle, wrap } from "./shared/ui";

/* Scoped styles preserved verbatim so the existing (working) FeedbackForm
   keeps its original look. Do not restyle FeedbackForm. */
const FEEDBACK_CSS = `
.lp-feedback{--card:#16203A;--inset:#1A2236;--border:#243049;--text:#E8EDF5;--muted:#9AA6B8;--hint:#5C6679;--green:#4ADE9E;--green-deep:#1D9E75;color:var(--text);line-height:1.6}
.lp-feedback *{margin:0;padding:0;box-sizing:border-box}
.lp-feedback .btn{display:inline-flex;align-items:center;gap:8px;border:none;border-radius:11px;font-weight:600;cursor:pointer;transition:transform .15s,box-shadow .2s;font-size:15px}
.lp-feedback .btn-green{background:var(--green-deep);color:#fff;padding:12px 20px}
.lp-feedback .fb-card{background:var(--card);border:.5px solid var(--border);border-radius:18px;padding:28px}
.lp-feedback .fb-card h3{font-size:20px;margin-bottom:6px;font-weight:600;letter-spacing:-.02em;line-height:1.2}
.lp-feedback .fb-sub{font-size:14px;color:var(--muted);margin-bottom:22px}
.lp-feedback .fb-label{display:block;font-size:13px;color:var(--muted);margin-bottom:8px;margin-top:18px}
.lp-feedback .fb-label:first-of-type{margin-top:0}
.lp-feedback .fb-input,.lp-feedback .fb-textarea{width:100%;background:var(--inset);border:.5px solid var(--border);border-radius:11px;color:var(--text);font-size:15px;padding:12px 14px;font-family:inherit;outline:none;transition:border-color .2s}
.lp-feedback .fb-input:focus,.lp-feedback .fb-textarea:focus{border-color:var(--green)}
.lp-feedback .fb-input::placeholder,.lp-feedback .fb-textarea::placeholder{color:var(--hint)}
.lp-feedback .fb-textarea{min-height:120px;resize:vertical;line-height:1.6}
.lp-feedback .fb-stars{display:flex;gap:8px}
.lp-feedback .fb-star{background:none;border:none;cursor:pointer;font-size:28px;line-height:1;color:var(--border);padding:0;transition:color .15s,transform .15s}
.lp-feedback .fb-star:hover{transform:scale(1.12)}
.lp-feedback .fb-star.on{color:#EF9F27}
.lp-feedback .fb-submit{width:100%;justify-content:center;margin-top:26px;padding:14px}
`;

export function ContactFeedbackSection() {
  return (
    <section id="contact" className="relative z-10 border-y border-[var(--rz-border)] py-[96px] max-md:py-[48px]">
      <div className={wrap}>
        <Reveal>
          <div className="mx-auto mb-12 text-center">
            <span className={eyebrowSm}>เสียงของคุณสำคัญ</span>
            <h2 className={sectionTitle}>ฟีดแบ็ก &amp; ติดต่อสอบถาม</h2>
            <p className={`${sectionSub} mx-auto`}>อยากให้ Rizance ดีขึ้นตรงไหน หรือมีคำถาม บอกเราได้เลย</p>
          </div>
        </Reveal>
        <div className="grid grid-cols-1 items-start gap-[18px] md:grid-cols-2">
          <div className="lp-feedback">
            <style dangerouslySetInnerHTML={{ __html: FEEDBACK_CSS }} />
            <FeedbackForm />
          </div>
          <ContactCard />
        </div>
      </div>
    </section>
  );
}
