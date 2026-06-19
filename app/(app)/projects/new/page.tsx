import { redirect } from "next/navigation";
import { getUserLongProject } from "@/lib/project-queries";
import { getCurrentUser } from "@/lib/session";
import { ProjectBack } from "@/components/project/ProjectBack";
import { CreateProjectForm } from "@/components/project/CreateProjectForm";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const existingOrg = await getUserLongProject(user.id);
  if (existingOrg) {
    redirect(`/projects/${existingOrg.id}`);
  }

  return (
    <div className="pb-6" data-context="project">
      <ProjectBack href="/projects" />
      <div className="px-4 pt-3">
        <h1 className="text-lg font-medium text-rz-text">สร้างองค์กร/ชมรม</h1>
      </div>
      <div className="mt-4">
        <CreateProjectForm />
      </div>
    </div>
  );
}
