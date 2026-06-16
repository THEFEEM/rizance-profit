import Link from "next/link";
import { ProjectIconBox } from "@/components/project/icons";
import { ProjectStatusBadge } from "@/components/project/ProjectStatusBadge";
import { formatMoney, moneySign } from "@/lib/money";
import { PROJECT_TYPE_ICON, PROJECT_TYPE_LABELS } from "@/lib/project-ui";
import type { ProjectListItem } from "@/types/project";

export function ProjectList({
  projects,
  currency = "THB",
}: {
  projects: ProjectListItem[];
  currency?: string;
}) {
  const active = projects.filter((p) => p.status === "active");
  const planning = projects.filter((p) => p.status === "planning");
  const closed = projects.filter((p) => p.status === "closed");

  if (projects.length === 0) {
    return (
      <div className="rounded-[12px] border-[0.5px] border-rz-border bg-rz-card px-4 py-10 text-center">
        <p className="text-sm text-rz-hint">ยังไม่มีโครงการ</p>
        <p className="mt-1 text-xs text-rz-placeholder">สร้างโครงการแรกเพื่อเริ่มบันทึกงบประมาณ</p>
        <Link
          href="/projects/new"
          className="tap-target mt-4 inline-flex rounded-full border-[0.5px] border-[#1E3A52] bg-[#15293F] px-5 py-2.5 text-sm font-medium text-rz-blue active:opacity-90"
        >
          ＋ สร้างโครงการ
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {active.length > 0 && (
        <section>
          <SectionHeader label="กำลังดำเนินงาน" count={active.length} dotClass="bg-rz-green" />
          <ul className="mt-2.5 space-y-2.5">
            {active.map((p) => (
              <li key={p.id}>
                <OpenProjectCard project={p} currency={currency} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {planning.length > 0 && (
        <section>
          <SectionHeader label="วางแผน" count={planning.length} dotClass="bg-rz-blue" />
          <ul className="mt-2.5 space-y-2.5">
            {planning.map((p) => (
              <li key={p.id}>
                <PlanningProjectCard project={p} currency={currency} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {closed.length > 0 && (
        <section>
          <SectionHeader label="ปิดแล้ว" count={closed.length} dotClass="bg-rz-muted" />
          <ul className="mt-2.5 space-y-2.5">
            {closed.map((p) => (
              <li key={p.id}>
                <ClosedProjectCard project={p} currency={currency} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SectionHeader({
  label,
  count,
  dotClass,
}: {
  label: string;
  count: number;
  dotClass: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden />
      <h2 className="text-sm font-medium text-rz-muted">
        {label} ({count} โครงการ)
      </h2>
    </div>
  );
}

function projectSubline(project: ProjectListItem): string {
  const parts = [PROJECT_TYPE_LABELS[project.projectType]];
  if (project.orgName) parts.push(project.orgName);
  if (project.projectType === "long" && project.activityCount > 0) {
    parts.push(`${project.activityCount} กิจกรรม`);
  }
  return parts.join(" · ");
}

function ProjectTypeIcon({ projectType }: { projectType: ProjectListItem["projectType"] }) {
  const cfg = PROJECT_TYPE_ICON[projectType];
  return <ProjectIconBox name={cfg.icon} color={cfg.color} bg={cfg.bg} />;
}

function OpenProjectCard({
  project,
  currency,
}: {
  project: ProjectListItem;
  currency: string;
}) {
  const remainSign = moneySign(project.remaining);

  return (
    <Link
      href={`/projects/${project.id}`}
      className="tap-target flex items-center gap-3 rounded-[12px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3.5 active:bg-rz-elevated"
    >
      <ProjectTypeIcon projectType={project.projectType} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-rz-text">{project.name}</p>
          <ProjectStatusBadge status={project.status} />
        </div>
        <p className="mt-0.5 truncate text-xs text-rz-hint">{projectSubline(project)}</p>
        <p className="mt-1.5 text-xs rz-tabular">
          <span className={remainSign >= 0 ? "text-rz-green" : "text-rz-red"}>
            เหลือ {formatMoney(project.remaining, currency)}
          </span>
          <span className="text-rz-placeholder"> / </span>
          <span className="text-rz-red">ใช้ {formatMoney(project.totalSpent, currency)}</span>
        </p>
      </div>
    </Link>
  );
}

function PlanningProjectCard({
  project,
  currency,
}: {
  project: ProjectListItem;
  currency: string;
}) {
  const remainSign = moneySign(project.remaining);

  return (
    <Link
      href={`/projects/${project.id}`}
      className="tap-target flex items-center gap-3 rounded-[12px] border-[0.5px] border-[#1E3A52]/60 bg-rz-card/80 px-4 py-3.5 opacity-95 active:bg-rz-elevated"
    >
      <ProjectTypeIcon projectType={project.projectType} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-rz-text">{project.name}</p>
          <ProjectStatusBadge status={project.status} />
        </div>
        <p className="mt-0.5 truncate text-xs text-rz-hint">{projectSubline(project)}</p>
        <p className="mt-1.5 text-xs rz-tabular">
          <span className={remainSign >= 0 ? "text-rz-green" : "text-rz-red"}>
            เหลือ {formatMoney(project.remaining, currency)}
          </span>
          <span className="text-rz-placeholder"> / </span>
          <span className="text-rz-red">ใช้ {formatMoney(project.totalSpent, currency)}</span>
        </p>
      </div>
    </Link>
  );
}

function ClosedProjectCard({
  project,
  currency,
}: {
  project: ProjectListItem;
  currency: string;
}) {
  const remainSign = moneySign(project.remaining);
  const remainColor =
    remainSign > 0 ? "text-rz-green" : remainSign < 0 ? "text-rz-red" : "text-rz-hint";

  return (
    <div className="rounded-[12px] border-[0.5px] border-rz-border bg-rz-elevated/40 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <ProjectTypeIcon projectType={project.projectType} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-rz-text">{project.name}</p>
            <ProjectStatusBadge status={project.status} />
          </div>
          <p className="mt-0.5 truncate text-xs text-rz-hint">{projectSubline(project)}</p>
        </div>
      </div>

      <p className="mt-2.5 text-xs leading-relaxed text-rz-hint rz-tabular">
        <span className="text-rz-blue">รายรับรวม {formatMoney(project.totalFunding, currency)}</span>
        {" / "}
        <span className="text-rz-red">รายจ่ายรวม {formatMoney(project.totalSpent, currency)}</span>
        {" / "}
        <span className={remainColor}>คงเหลือ {formatMoney(project.remaining, currency)}</span>
      </p>

      <Link
        href={`/projects/${project.id}/summary`}
        className="tap-target mt-2.5 inline-block text-xs font-medium text-rz-blue active:opacity-90"
      >
        ดูสรุปเต็ม →
      </Link>
    </div>
  );
}
