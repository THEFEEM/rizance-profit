import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { pool } from "@/lib/db";
import {
  EmployeeCodeTakenError,
  createEmployee,
  listEmployees,
} from "@/lib/hr-employee-queries";
import { employeeCreateSchema } from "@/lib/hr-validation";

/** HR — ทะเบียนพนักงาน (owner เท่านั้น · JWT + plan) */

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const includeInactive = req.nextUrl.searchParams.get("all") === "1";
  const employees = await listEmployees(userId, { includeInactive });
  return NextResponse.json({ data: { employees } });
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
  const parsed = employeeCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // สาขาต้องเป็นของร้านนี้ — กันยิง branch_id ข้ามร้าน
  if (parsed.data.branchId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM branches WHERE id = $1 AND user_id = $2`,
      [parsed.data.branchId, userId],
    );
    if (!rows[0]) return NextResponse.json({ error: "invalid_branch" }, { status: 400 });
  }

  try {
    // staffToken โผล่ครั้งเดียวใน response นี้ — DB มีแต่ hash
    const { employee, staffToken } = await createEmployee(userId, parsed.data);
    return NextResponse.json({ data: { employee, staffToken } }, { status: 201 });
  } catch (err) {
    if (err instanceof EmployeeCodeTakenError) {
      return NextResponse.json({ error: "code_taken" }, { status: 409 });
    }
    throw err;
  }
}
