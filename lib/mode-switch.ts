import type { ProjectListItem } from "@/types/project";

export function activeOrgProjects(projects: ProjectListItem[]): ProjectListItem[] {
  return projects.filter((p) => p.projectType === "long" && p.status !== "closed");
}
