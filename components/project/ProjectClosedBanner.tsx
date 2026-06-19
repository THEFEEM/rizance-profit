import type { ProjectType } from "@/types/project";
import { projectScopeNoun } from "@/lib/project-ui";

export function ProjectClosedBanner({ projectType = "long" }: { projectType?: ProjectType }) {
  const noun = projectScopeNoun(projectType);
  return (
    <div
      className="mx-4 rounded-[11px] border-[0.5px] border-rz-purple-border bg-rz-purple-bg px-4 py-3 text-sm text-rz-purple"
      role="status"
    >
      {noun}ปิดแล้ว — ไม่สามารถเพิ่มรายการได้
    </div>
  );
}
