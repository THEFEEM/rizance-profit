import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { createBranch, listBranches, updateBranch } from "@/lib/hr-employee-queries";
import { branchCreateSchema, branchPatchSchema } from "@/lib/hr-validation";

/** HR — สาขา (dimension ใหม่ · user_id = business ตาม convention เดิม) */

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  return NextResponse.json({ data: { branches: await listBranches(userId) } });
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
  const parsed = branchCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    const branch = await createBranch(userId, parsed.data.name);
    return NextResponse.json({ data: { branch } }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "name_taken" }, { status: 409 });
    }
    throw err;
  }
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
  const parsed = branchPatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const { id, ...input } = parsed.data;
  const ok = await updateBranch(userId, id, input);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: { ok: true } });
}
