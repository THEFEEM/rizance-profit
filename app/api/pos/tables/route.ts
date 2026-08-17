import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { pool } from "@/lib/db";

/**
 * โต๊ะ (0075) — จัดการ QR รายโต๊ะสำหรับ NINENON Self-Order
 * QR ต่อโต๊ะ = /m/<menuToken>?t=<code> (สร้างฝั่ง POS จาก token ที่มีอยู่)
 */

type PosTableRow = {
  id: string;
  code: string;
  label: string;
  is_active: boolean;
  sort_order: number;
};

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { rows } = await pool.query<PosTableRow>(
    `SELECT id, code, label, is_active, sort_order FROM pos_tables
     WHERE user_id = $1 ORDER BY sort_order, code`,
    [userId],
  );
  return NextResponse.json({
    data: {
      tables: rows.map((r) => ({
        id: r.id,
        code: r.code,
        label: r.label,
        isActive: r.is_active,
        sortOrder: r.sort_order,
      })),
    },
  });
}

const createSchema = z.object({
  code: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
    z.string().min(1).max(10).regex(/^[A-Z0-9]+$/, "ใช้ A-Z 0-9"),
  ),
  label: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1).max(40)),
});

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO pos_tables (user_id, code, label,
         sort_order)
       VALUES ($1, $2, $3,
         COALESCE((SELECT MAX(sort_order) + 1 FROM pos_tables WHERE user_id = $1), 0))
       RETURNING id`,
      [userId, parsed.data.code, parsed.data.label],
    );
    return NextResponse.json({ data: { id: rows[0].id } }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "code_taken" }, { status: 409 });
    }
    throw err;
  }
}

const patchSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(40).optional(),
  isActive: z.boolean().optional(),
});

/** PATCH — แก้ชื่อ/เปิดปิดโต๊ะ (id ใน body — โต๊ะมีไม่กี่ตัว ไม่ต้องแตก route) */
export async function PATCH(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const { rowCount } = await pool.query(
    `UPDATE pos_tables SET
       label = COALESCE($3, label),
       is_active = COALESCE($4, is_active)
     WHERE id = $2 AND user_id = $1`,
    [userId, parsed.data.id, parsed.data.label ?? null, parsed.data.isActive ?? null],
  );
  if (!rowCount) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: { ok: true } });
}
