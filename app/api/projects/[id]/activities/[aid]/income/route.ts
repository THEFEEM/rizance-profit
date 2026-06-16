import { NextRequest, NextResponse } from "next/server";
import { createProjectIncome, getProjectActivity, listProjectIncome } from "@/lib/project-queries";
import { projectIncomeSchema } from "@/lib/project-validation";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; aid: string }> },
) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id: projectId, aid: activityId } = await params;
  const activity = await getProjectActivity(userId, projectId, activityId);
  if (!activity) {
    return NextResponse.json({ error: { message: "ไม่พบกิจกรรมนี้" } }, { status: 404 });
  }

  const data = await listProjectIncome(userId, activityId);
  return NextResponse.json({ data });
}

export async function POST(
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

  const parsed = projectIncomeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const activity = await getProjectActivity(userId, projectId, activityId);
  if (!activity) {
    return NextResponse.json({ error: { message: "ไม่พบกิจกรรมนี้" } }, { status: 404 });
  }

  const data = await createProjectIncome(userId, activityId, parsed.data);
  if (!data) {
    return NextResponse.json({ error: { message: "ไม่พบกิจกรรมนี้" } }, { status: 404 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
