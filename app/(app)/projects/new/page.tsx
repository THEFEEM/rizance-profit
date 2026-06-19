import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { ProjectModeSwitcher } from "@/components/project/ProjectModeSwitcher";
import { ProjectBack } from "@/components/project/ProjectBack";
import { CreateProjectForm } from "@/components/project/CreateProjectForm";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="pb-6" data-context="project">
      <ProjectBack href="/projects" />
      <ProjectModeSwitcher userId={user.id} />
      <div className="px-4 pt-1">
        <h1 className="text-lg font-medium text-rz-text">สร้างโครงการใหม่</h1>
        <p className="text-xs text-rz-hint">ระยะสั้น = กิจกรรมเดียว · ระยะยาว = หลายกิจกรรมย่อย</p>
      </div>
      <div className="mt-4">
        <CreateProjectForm />
      </div>
    </div>
  );
}
