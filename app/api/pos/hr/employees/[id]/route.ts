import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { pool } from "@/lib/db";
import {
  EmployeeCodeTakenError,
  getEmployee,
  rotateEmployeeToken,
  updateEmployee,
} from "@/lib/hr-employee-queries";
import { employeePatchSchema } from "@/lib/hr-validation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const employee = await getEmployee(userId, id);
  if (!employee) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: { employee } });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = employeePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  if ("action" in parsed.data) {
    // rotate — token เดิมตายทันที ตัวใหม่โชว์ครั้งเดียว
    const rotated = await rotateEmployeeToken(userId, id);
    if (!rotated) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ data: rotated });
  }

  if (parsed.data.branchId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM branches WHERE id = $1 AND user_id = $2`,
      [parsed.data.branchId, userId],
    );
    if (!rows[0]) return NextResponse.json({ error: "invalid_branch" }, { status: 400 });
  }

  try {
    const employee = await updateEmployee(userId, id, parsed.data);
    if (!employee) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ data: { employee } });
  } catch (err) {
    if (err instanceof EmployeeCodeTakenError) {
      return NextResponse.json({ error: "code_taken" }, { status: 409 });
    }
    throw err;
  }
}
