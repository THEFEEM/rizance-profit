"use client";

import { useState } from "react";
import { Mail, Phone, Copy, Check } from "lucide-react";
import { focusRing } from "./shared/ui";

const EMAIL = "lutfee7890@gmail.com";
const PHONE_DISPLAY = "096 719 8011";
const PHONE_TEL = "0967198011";

const rowClass =
  "group flex items-center gap-3.5 rounded-[14px] border border-[var(--rz-border)] bg-[var(--rz-elevated)] p-4 transition-[transform,border-color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[rgba(74,222,158,0.4)] motion-reduce:transition-none motion-reduce:hover:translate-y-0";
const iconBox =
  "flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-[var(--rz-green)]/10 text-[var(--rz-green)]";
const labelClass = "text-[11px] uppercase tracking-wide text-[var(--rz-muted)]";
const valueClass = "font-mono text-[14px] font-semibold text-[var(--rz-text)] break-all";

export function ContactCard() {
  const [copied, setCopied] = useState(false);

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return (
    <div className="rounded-[18px] border border-[var(--rz-border)] bg-[var(--rz-card)] p-7">
      <h3 className="mb-1.5 font-serif text-xl font-semibold text-[var(--rz-text)]">ติดต่อสอบถาม</h3>
      <p className="mb-6 text-[14px] text-[var(--rz-muted)]">
        มีคำถามเรื่องการใช้งาน ราคา หรือสนใจแพ็กเทีม ทักได้เลย
      </p>

      <div className="flex flex-col gap-3.5">
        <div className={rowClass}>
          <a href={`mailto:${EMAIL}`} className={`flex min-w-0 flex-1 items-center gap-3.5 rounded-[10px] ${focusRing}`}>
            <span className={iconBox}>
              <Mail size={20} strokeWidth={2} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <small className={labelClass}>อีเมล</small>
              <b className={valueClass}>{EMAIL}</b>
            </span>
          </a>
          <button
            type="button"
            onClick={copyEmail}
            aria-label={copied ? "คัดลอกแล้ว" : "คัดลอกอีเมล"}
            className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--rz-border)] text-[var(--rz-muted)] transition-colors hover:border-[rgba(74,222,158,0.4)] hover:text-[var(--rz-green)] ${focusRing}`}
          >
            {copied ? <Check size={16} className="text-[var(--rz-green)]" /> : <Copy size={16} />}
            {copied && (
              <span className="pointer-events-none absolute -top-8 right-0 whitespace-nowrap rounded-md border border-[var(--rz-border)] bg-[var(--rz-elevated)] px-2 py-1 text-[11px] font-medium text-[var(--rz-text)]">
                คัดลอกแล้ว
              </span>
            )}
          </button>
        </div>

        <a href={`tel:${PHONE_TEL}`} className={`${rowClass} ${focusRing}`}>
          <span className={iconBox}>
            <Phone size={20} strokeWidth={2} />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <small className={labelClass}>โทรศัพท์</small>
            <b className={valueClass}>{PHONE_DISPLAY}</b>
          </span>
        </a>
      </div>

      <p className="mt-4 text-[13px] leading-[1.6] text-[var(--rz-muted)]">
        เราตอบกลับทุกข้อความ ปกติภายใน 1 วันทำการ — ไม่ว่าจะเป็นคำถามการใช้งาน ขอเดโม
        หรือปรึกษาแพ็กเกจสำหรับนิติบุคคล
      </p>
    </div>
  );
}
