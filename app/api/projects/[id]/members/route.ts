import { NextRequest, NextResponse } from "next/server";
import { createProjectMember, getProject, listProjectMembers } from "@/lib/project-queries";
import { projectMemberSchema } from "@/lib/project-validation";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id } = await params;
  const project = await getProject(userId, id);
  if (!project) return NextResponse.json({ error: { message: "ไม่พบโครงการนี้" } }, { status: 404 });

  const data = await listProjectMembers(userId, id);
  return NextResponse.json({ data });
}

export async function POST(
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

  const parsed = projectMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const data = await createProjectMember(userId, id, parsed.data);
  if (!data) return NextResponse.json({ error: { message: "ไม่พบโครงการนี้" } }, { status: 404 });
  return NextResponse.json({ data }, { status: 201 });
}
