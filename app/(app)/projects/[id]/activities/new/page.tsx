import { redirect, notFound } from "next/navigation";
import { getProject } from "@/lib/project-queries";
import { getCurrentUser } from "@/lib/session";
import { ProjectModeSwitcher } from "@/components/project/ProjectModeSwitcher";
import { CreateActivityForm } from "@/components/project/CreateActivityForm";
import { ProjectBack } from "@/components/project/ProjectBack";

export const dynamic = "force-dynamic";

export default async function NewActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;

  const project = await getProject(user.id, id);
  if (!project) notFound();
  if (project.projectType !== "long") redirect(`/projects/${id}`);

  return (
    <div className="pb-6" data-context="project">
      <ProjectBack href={`/projects/${id}`} />
      <ProjectModeSwitcher userId={user.id} project={project} />
      <div className="px-4 pt-1">
        <h1 className="text-lg font-medium text-rz-text">เพิ่มกิจกรรมย่อย</h1>
        <p className="text-xs text-rz-hint">{project.name}</p>
      </div>
      <div className="mt-4">
        <CreateActivityForm projectId={id} />
      </div>
    </div>
  );
}
