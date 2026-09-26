import { NextRequest, NextResponse } from "next/server";
import { createProject, getUserLongProject } from "@/lib/project-queries";
import { listProjectSummaries } from "@/lib/project-summary";
import { projectSchema } from "@/lib/project-validation";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";
import { orgApiGuard } from "@/lib/mode-access";

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  // 4.3C: GET รายการ **ตั้งใจไม่ใส่ orgApiGuard** — ModePicker/ProfileModeSection เรียกให้ทุกคน
  // ผู้ใช้ที่ไม่ใช่ grandfathered ไม่มีโปรเจกต์ (นิยามเดียวกัน) จึงได้ [] อยู่แล้ว · 403 จะกลายเป็น error banner ใน Shop/Booth
  const data = await listProjectSummaries(userId);
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  const retired = await orgApiGuard(userId);
  if (retired) return retired;

  const existingOrg = await getUserLongProject(userId);
  if (existingOrg) {
    return NextResponse.json(
      {
        error: {
          code: "already_has_org",
          message: "คุณมีองค์กร/ชมรมแล้ว — สร้างได้เพียงหนึ่งองค์กรต่อบัญชี",
        },
      },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = projectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const data = await createProject(userId, parsed.data);
  return NextResponse.json({ data }, { status: 201 });
}
