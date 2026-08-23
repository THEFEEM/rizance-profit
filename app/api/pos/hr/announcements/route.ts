import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  createAnnouncement,
  listAnnouncements,
  setAnnouncementActive,
} from "@/lib/hr-ops-queries";
import { z } from "zod";

/** ประกาศจากร้าน — โชว์บนหน้าแรกแอปพนักงานทุกคน */

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  return NextResponse.json({
    data: { announcements: await listAnnouncements(userId, false) },
  });
}

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = z.object({ body: z.string().trim().min(1).max(500) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  await createAnnouncement(userId, parsed.data.body);
  return NextResponse.json({ data: { ok: true } }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = z
    .object({ id: z.string().uuid(), isActive: z.boolean() })
    .safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const ok = await setAnnouncementActive(userId, parsed.data.id, parsed.data.isActive);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: { ok: true } });
}
