import { NextRequest, NextResponse } from "next/server";
import { getProjectActivity, updateActivity } from "@/lib/project-queries";
import { projectActivityPatchSchema } from "@/lib/project-validation";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; aid: string }> },
) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id: projectId, aid: activityId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = projectActivityPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const existing = await getProjectActivity(userId, projectId, activityId);
  if (!existing) {
    return NextResponse.json({ error: { message: "ไม่พบกิจกรรมนี้" } }, { status: 404 });
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

  const data = await updateActivity(userId, projectId, activityId, parsed.data);
  if (!data) return NextResponse.json({ error: { message: "ไม่พบกิจกรรมนี้" } }, { status: 404 });
  return NextResponse.json({ data });
}
