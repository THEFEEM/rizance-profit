import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  createChecklistTemplate,
  listChecklistTemplates,
  updateChecklistTemplate,
} from "@/lib/hr-ops-queries";
import { z } from "zod";

/** Checklist templates — owner แก้ได้ (รายการรายวันสร้างจากตัวนี้) */

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  return NextResponse.json({ data: { templates: await listChecklistTemplates(userId) } });
}

const createSchema = z.object({
  // 0084: เพิ่ม 'manager' — เจ้าของแก้รายการ Manager Duty ได้จากหน้าเดิม
  phase: z.enum(["opening", "during", "closing", "manager"]),
  title: z.string().trim().min(1).max(120),
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

  const template = await createChecklistTemplate(userId, parsed.data);
  return NextResponse.json({ data: { template } }, { status: 201 });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
});

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

  const { id, ...input } = parsed.data;
  const ok = await updateChecklistTemplate(userId, id, input);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: { ok: true } });
}
