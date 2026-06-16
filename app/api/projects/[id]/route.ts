import { NextRequest, NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/project-queries";
import { projectPatchSchema } from "@/lib/project-validation";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id } = await params;
  const data = await getProject(userId, id);
  if (!data) return NextResponse.json({ error: { message: "ไม่พบโครงการนี้" } }, { status: 404 });
  return NextResponse.json({ data });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = projectPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const existing = await getProject(userId, id);
  if (!existing) {
    return NextResponse.json({ error: { message: "ไม่พบโครงการนี้" } }, { status: 404 });
  }

  const start = parsed.data.startDate !== undefined ? parsed.data.startDate : existing.startDate;
  const end = parsed.data.endDate !== undefined ? parsed.data.endDate : existing.endDate;
  if (start && end && end < start) {
    return NextResponse.json(
      {
        error: {
          message: "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม",
          fields: { endDate: ["วันสิ้นสุดต้องไม่ก่อนวันเริ่ม"] },
        },
      },
      { status: 400 },
    );
  }

  const data = await updateProject(userId, id, parsed.data);
  if (!data) return NextResponse.json({ error: { message: "ไม่พบโครงการนี้" } }, { status: 404 });
  return NextResponse.json({ data });
}
