import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  createNote,
  listNotes,
  reportProblemFromPos,
  updateNote,
  updateNoteStatus,
} from "@/lib/store-note-queries";
import { z } from "zod";

/**
 * สมุดร้าน — ฝั่งเจ้าของ/ผู้จัดการ (หลัง requirePosSessionAndPlan)
 *
 * GET    ?status=&type=&priority=   รายการโน้ต (ด่วนที่ยังไม่แก้ขึ้นบนสุด)
 * POST                              เขียนโน้ต · หรือแจ้งปัญหาจากเครื่อง POS
 * PATCH                             แก้ไข / กดแก้แล้ว / เก็บเข้ากรุ
 *
 * ⚠️ POST แบบ fromPos = แจ้งจากเครื่องหน้าร้าน — ไม่มีตัวตนผู้แจ้ง
 *    ต่อให้เซสชันเป็นของเจ้าของ ก็ห้ามเอาไปใส่เป็นชื่อผู้แจ้ง
 */

const NOTE_TYPES = ["general", "problem", "todo", "reminder", "idea"] as const;
const PRIORITIES = ["normal", "important", "urgent"] as const;
const STATUSES = ["open", "resolved", "archived"] as const;

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const sp = new URL(req.url).searchParams;
  const pick = <T extends readonly string[]>(v: string | null, allowed: T) =>
    v && (allowed as readonly string[]).includes(v) ? (v as T[number]) : undefined;

  return NextResponse.json({
    data: await listNotes(userId, {
      status: pick(sp.get("status"), STATUSES),
      type: pick(sp.get("type"), NOTE_TYPES),
      priority: pick(sp.get("priority"), PRIORITIES),
    }),
  });
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().max(2000).nullish(),
  type: z.enum(NOTE_TYPES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  visibility: z.enum(["owner_manager", "store_team"]).optional(),
  /** true = แจ้งจากเครื่อง POS (ไม่ระบุตัวผู้แจ้ง) */
  fromPos: z.boolean().optional(),
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

  const note = parsed.data.fromPos
    ? await reportProblemFromPos(userId, {
        title: parsed.data.title,
        body: parsed.data.body,
        priority: parsed.data.priority,
      })
    : await createNote(userId, parsed.data);

  return NextResponse.json({ data: { note } }, { status: 201 });
}

const patchSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(STATUSES).optional(),
    title: z.string().trim().min(1).max(160).optional(),
    body: z.string().trim().max(2000).nullish(),
    type: z.enum(NOTE_TYPES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    visibility: z.enum(["owner_manager", "store_team"]).optional(),
  })
  .refine((d) => Object.keys(d).length > 1, { message: "nothing to update" });

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

  const { id, status, ...rest } = parsed.data;
  const note = status
    ? await updateNoteStatus(userId, id, status)
    : await updateNote(userId, id, rest);
  if (!note) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: { note } });
}
