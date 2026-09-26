import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { SHOW_ORG_MODE, SHOW_PERSONAL_MODE } from "@/lib/feature-flags";

/**
 * Soft retirement ของโหมด Personal / Organization-Project (PHASE 4.3C)
 *
 * Rizance สำหรับผู้ใช้ใหม่ = Shop + Booth เท่านั้น
 * ผู้ใช้เดิมที่มีข้อมูลโหมดเหล่านี้อยู่แล้ว (grandfathered) ยังเข้าได้ตามเดิม
 *
 * จุดตัดสินสิทธิ์รวมศูนย์ที่ไฟล์นี้ — page guard · API guard · /api/context · resolveTodayContext
 * ใช้ canUsePersonalMode / canUseOrgMode ตัวเดียวกัน ห้ามเขียนเงื่อนไข flag ซ้ำที่อื่น
 */

type AccessProbe = {
  personal: (userId: string) => Promise<boolean>;
  org: (userId: string) => Promise<boolean>;
};

const dbProbe: AccessProbe = {
  async personal(userId) {
    const { rows } = await pool.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM personal_income_entries WHERE user_id = $1
         UNION ALL
         SELECT 1 FROM personal_expense_entries WHERE user_id = $1
         UNION ALL
         SELECT 1 FROM savings_goals WHERE user_id = $1
       ) AS ok`,
      [userId],
    );
    return rows[0]?.ok === true;
  },
  async org(userId) {
    const { rows } = await pool.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM projects WHERE user_id = $1) AS ok`,
      [userId],
    );
    return rows[0]?.ok === true;
  },
};

let probe: AccessProbe = dbProbe;

/** เทสเท่านั้น — แทนการ query DB เพื่อจำลองผู้ใช้ grandfathered/ไม่ใช่ · production ปฏิเสธ */
export function setModeAccessProbeForTests(p: AccessProbe | null): void {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1") {
    throw new Error("setModeAccessProbeForTests is not allowed in production");
  }
  probe = p ?? dbProbe;
}

/** True when the user has any personal-mode ledger data (grandfather access). */
export async function userHasPersonalData(userId: string): Promise<boolean> {
  return probe.personal(userId);
}

/** True when the user owns at least one project (grandfather access). */
export async function userHasOrgData(userId: string): Promise<boolean> {
  return probe.org(userId);
}

/** เข้าโหมด Personal ได้ไหม: flag เปิด หรือเป็นผู้ใช้เดิมที่มีข้อมูล */
export async function canUsePersonalMode(userId: string): Promise<boolean> {
  if (SHOW_PERSONAL_MODE) return true;
  return userHasPersonalData(userId);
}

/** เข้าโหมด Organization/Project ได้ไหม: flag เปิด หรือเป็นผู้ใช้เดิมที่มีโปรเจกต์ */
export async function canUseOrgMode(userId: string): Promise<boolean> {
  if (SHOW_ORG_MODE) return true;
  return userHasOrgData(userId);
}

/** 403 มาตรฐานของโหมดที่ปลดระวางแล้ว — ไม่บอกใบ้อะไรเกินจำเป็น */
export function retiredModeResponse(mode: "personal" | "org"): NextResponse {
  return NextResponse.json(
    {
      error: {
        message: mode === "personal" ? "โหมดส่วนตัวปิดให้บริการแล้ว" : "โหมดองค์กรปิดให้บริการแล้ว",
        code: "mode_retired",
        mode,
      },
    },
    { status: 403 },
  );
}

/**
 * API guard — เรียกทันทีหลังตรวจ auth ในทุก route ของ /api/personal/*
 * คืน 403 สำหรับผู้ใช้ที่ไม่มีสิทธิ์ · คืน null = ไปต่อได้ (พฤติกรรมเดิม)
 */
export async function personalApiGuard(userId: string): Promise<NextResponse | null> {
  return (await canUsePersonalMode(userId)) ? null : retiredModeResponse("personal");
}

/** API guard สำหรับ /api/projects/* (ยกเว้น GET รายการ — ดูหมายเหตุในไฟล์ route) */
export async function orgApiGuard(userId: string): Promise<NextResponse | null> {
  return (await canUseOrgMode(userId)) ? null : retiredModeResponse("org");
}

/** Redirect to /home when personal routes are hidden and user has no personal data. */
export async function guardPersonalRoute(userId: string): Promise<void> {
  if (await canUsePersonalMode(userId)) return;
  redirect("/home");
}

/** Redirect to /home when org routes are hidden and user has no projects. */
export async function guardOrgRoute(userId: string): Promise<void> {
  if (await canUseOrgMode(userId)) return;
  redirect("/home");
}
