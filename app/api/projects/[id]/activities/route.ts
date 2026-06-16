import { NextRequest, NextResponse } from "next/server";
import { createActivity, getProject } from "@/lib/project-queries";
import { projectActivitySchema } from "@/lib/project-validation";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id: projectId } = await params;

  const project = await getProject(userId, projectId);
  if (!project) {
    return NextResponse.json({ error: { message: "ไม่พบโครงการนี้" } }, { status: 404 });
  }
  if (project.projectType !== "long") {
    return NextResponse.json(
      { error: { message: "โครงการระยะสั้นมีกิจกรรมเดียว — ไม่สามารถเพิ่มกิจกรรมได้" } },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = projectActivitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const data = await createActivity(userId, projectId, parsed.data);
  if (!data) {
    return NextResponse.json({ error: { message: "ไม่สามารถสร้างกิจกรรมได้" } }, { status: 404 });
  }
  return NextResponse.json({ data }, { status: 201 });
}
