import Link from "next/link";
import { redirect } from "next/navigation";
import { listProjectSummaries } from "@/lib/project-summary";
import { getCurrentUser } from "@/lib/session";
import { ModeSwitcher } from "@/components/ModeSwitcher";
import { ProjectList } from "@/components/project/ProjectList";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const projects = await listProjectSummaries(user.id);

  return (
    <div className="pb-6" data-context="project">
      <ModeSwitcher mode="project" />
      <div className="flex items-center justify-between px-4 pt-1">
        <div>
          <h1 className="text-lg font-medium text-rz-text">โครงการทั้งหมด</h1>
          <p className="text-xs text-rz-hint">โครงการ / ชมรม / องค์กร</p>
        </div>
        <Link
          href="/projects/new"
          className="tap-target rounded-full border-[0.5px] border-[#1E3A52] bg-[#15293F] px-4 py-2 text-sm font-medium text-rz-blue active:opacity-90"
        >
          ＋ สร้างใหม่
        </Link>
      </div>
      <div className="mt-4 px-4">
        <ProjectList projects={projects} currency={user.currency} />
      </div>
    </div>
  );
}
