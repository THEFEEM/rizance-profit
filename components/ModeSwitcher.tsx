"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { orgDisplayName } from "@/lib/project-ui";
import type { Booth } from "@/types/booth";
import type { AppContext } from "@/types/context";
import type { ProjectListItem } from "@/types/project";
import {
  BuildingStoreIcon,
  ClipboardListIcon,
  TentIcon,
} from "@/components/project/icons";

import { formatDayShort } from "@/lib/date";

function formatDateRange(start: string, end: string): string {
  if (start === end) return formatDayShort(start);
  return `${formatDayShort(start)} – ${formatDayShort(end)}`;
}

type SwitcherMode = "regular" | "booth" | "project";

function activeOrgProjects(projects: ProjectListItem[]): ProjectListItem[] {
  return projects.filter((p) => p.projectType === "long" && p.status !== "closed");
}

export function ModeSwitcher({
  mode,
  forceProjectTab = false,
  boothId,
  boothName,
  boothStartDate,
  boothEndDate,
  projectId,
  projectName,
  orgName,
  projectStartDate,
  projectEndDate,
}: {
  mode: SwitcherMode;
  /** Highlight project tab on /projects/* when cookie is still regular. */
  forceProjectTab?: boolean;
  boothId?: string;
  boothName?: string;
  boothStartDate?: string;
  boothEndDate?: string;
  projectId?: string;
  projectName?: string;
  orgName?: string | null;
  projectStartDate?: string | null;
  projectEndDate?: string | null;
}) {
  const router = useRouter();
  const [picker, setPicker] = useState<"booth" | "project" | null>(null);
  const [booths, setBooths] = useState<Booth[] | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectTabSelected = mode === "project" || (forceProjectTab && mode === "regular");
  const orgLabel = mode === "project" && (orgName || projectName) ? orgDisplayName({ orgName: orgName ?? null, name: projectName ?? "" }) : "โครงการ";

  async function loadBooths(): Promise<Booth[]> {
    if (booths !== null) return booths;
    setLoading(true);
    const res = await apiFetch<Booth[]>("/api/booths");
    setLoading(false);
    if (res.ok) {
      setBooths(res.data);
      return res.data;
    }
    setError(res.message);
    setBooths([]);
    return [];
  }

  async function loadProjects(): Promise<ProjectListItem[]> {
    if (projects !== null) return projects;
    setLoading(true);
    const res = await apiFetch<ProjectListItem[]>("/api/projects");
    setLoading(false);
    if (res.ok) {
      setProjects(res.data);
      return res.data;
    }
    setError(res.message);
    setProjects([]);
    return [];
  }

  async function patchContext(
    body:
      | { mode: "regular" }
      | { mode: "booth"; boothId: string }
      | { mode: "project"; projectId: string },
  ) {
    setSwitching(true);
    setError(null);
    const res = await apiFetch<AppContext>("/api/context", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    setSwitching(false);
    if (res.ok) {
      setPicker(null);
      if (body.mode === "project" || mode === "project") router.push("/");
      router.refresh();
    } else {
      setError(res.message);
    }
  }

  async function switchToRegular() {
    if (mode === "regular" || switching) return;
    await patchContext({ mode: "regular" });
  }

  async function switchToBooth() {
    if (switching) return;
    if (mode === "booth") {
      setPicker("booth");
      setError(null);
      await loadBooths();
      return;
    }

    const list = await loadBooths();
    const open = list.filter((b) => b.status === "open");
    if (open.length === 1) {
      setSwitching(true);
      setError(null);
      const res = await apiFetch<AppContext>("/api/context", {
        method: "PATCH",
        body: JSON.stringify({ mode: "booth", boothId: open[0].id }),
      });
      setSwitching(false);
      if (res.ok) {
        if (mode === "project") router.push("/");
        router.refresh();
      } else {
        setError(res.message);
      }
      return;
    }
    setPicker("booth");
  }

  async function switchToProject() {
    if (switching) return;
    if (mode === "project") {
      setPicker("project");
      setError(null);
      await loadProjects();
      return;
    }

    const list = await loadProjects();
    const orgs = activeOrgProjects(list);
    if (orgs.length === 0) {
      router.push("/projects/new");
      return;
    }
    if (orgs.length === 1) {
      await patchContext({ mode: "project", projectId: orgs[0].id });
      return;
    }
    setPicker("project");
  }

  const openBooths = booths?.filter((b) => b.status === "open") ?? [];
  const closedBoothCount = booths?.filter((b) => b.status === "closed").length ?? 0;
  const openOrgs = projects ? activeOrgProjects(projects) : [];

  const tabBase =
    "tap-target flex flex-1 items-center justify-center gap-1 rounded-full py-2 text-xs font-medium transition-colors disabled:opacity-50 sm:text-sm";

  const projectSubtitle =
    mode === "project" && (orgName || projectName)
      ? orgDisplayName({ orgName: orgName ?? null, name: projectName ?? "" })
      : null;

  return (
    <>
      <div className="px-4 pt-1">
        <div
          className="flex rounded-full bg-rz-elevated p-[3px]"
          role="tablist"
          aria-label="สลับโหมด"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "regular"}
            disabled={switching}
            onClick={switchToRegular}
            className={`${tabBase} ${
              mode === "regular"
                ? "bg-rz-green text-rz-bg"
                : "text-rz-muted active:bg-rz-card"
            }`}
          >
            <BuildingStoreIcon size={14} />
            ร้านค้า
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "booth"}
            disabled={switching}
            onClick={switchToBooth}
            className={`${tabBase} ${
              mode === "booth"
                ? "bg-rz-amber text-rz-bg"
                : "text-rz-muted active:bg-rz-card"
            }`}
          >
            <TentIcon size={14} />
            บูธ
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={projectTabSelected}
            disabled={switching}
            onClick={switchToProject}
            className={`${tabBase} min-w-0 ${
              projectTabSelected
                ? "bg-rz-purple text-rz-bg"
                : "text-rz-muted active:bg-rz-card"
            }`}
          >
            <ClipboardListIcon size={14} className="shrink-0" />
            <span className="truncate">{orgLabel}</span>
          </button>
        </div>
        {mode === "booth" && boothName && (
          <p className="mt-2 flex items-center justify-center gap-1.5 truncate text-center text-[11px] font-medium text-rz-amber">
            <TentIcon size={12} />
            <span className="truncate">
              {boothName}
              {boothStartDate && boothEndDate && (
                <span className="text-rz-amber/80">
                  {" "}
                  · {formatDateRange(boothStartDate, boothEndDate)}
                </span>
              )}
            </span>
          </p>
        )}
        {projectSubtitle && (
          <p className="mt-2 flex items-center justify-center gap-1.5 truncate text-center text-[11px] font-medium text-rz-purple">
            <ClipboardListIcon size={12} />
            <span className="truncate">
              {projectSubtitle}
              {projectStartDate && projectEndDate && (
                <span className="text-rz-purple/80">
                  {" "}
                  · {formatDateRange(projectStartDate, projectEndDate)}
                </span>
              )}
            </span>
          </p>
        )}
      </div>

      {picker === "booth" && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="booth-picker-title"
          onClick={() => !switching && setPicker(null)}
        >
          <div
            className="flex max-h-[80dvh] w-full max-w-sm flex-col rounded-2xl border-[0.5px] border-rz-border bg-rz-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 p-4 pb-3">
              <h2 id="booth-picker-title" className="text-lg font-medium text-rz-text">
                เลือกงานบูธ
              </h2>
              <p className="mt-1 text-sm text-rz-muted">เลือกงานบูธที่เปิดอยู่</p>

              {error && (
                <p className="mt-3 text-sm text-rz-red" role="alert">
                  {error}
                </p>
              )}

              <Link
                href="/booth/new"
                onClick={() => setPicker(null)}
                className="tap-target mt-4 flex min-h-11 w-full items-center justify-center rounded-[12px] border-[0.5px] border-[#5A3F12] bg-[#2E2310] text-sm font-medium text-rz-amber active:opacity-90"
              >
                ＋ สร้างงานบูธใหม่
              </Link>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4">
              <ul className="divide-y divide-rz-border border-t-[0.5px] border-rz-border">
                {loading && (
                  <li className="px-2 py-3 text-sm text-rz-hint">กำลังโหลดงานบูธ…</li>
                )}

                {!loading &&
                  openBooths.map((b) => {
                    const isActive = mode === "booth" && boothId === b.id;
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          disabled={switching}
                          onClick={() => patchContext({ mode: "booth", boothId: b.id })}
                          className={`tap-target min-h-11 w-full px-2 py-3 text-left text-sm font-medium disabled:opacity-40 ${
                            isActive ? "text-rz-amber" : "text-rz-text"
                          }`}
                        >
                          {b.name}
                          {isActive && " ✓"}
                        </button>
                      </li>
                    );
                  })}

                {!loading && booths !== null && openBooths.length === 0 && (
                  <li className="px-2 py-4 text-center text-sm text-rz-hint">
                    ยังไม่มีงานบูธที่เปิดอยู่
                  </li>
                )}
              </ul>
            </div>

            <div className="shrink-0 border-t-[0.5px] border-rz-border p-4 pt-3">
              {!loading && booths !== null && closedBoothCount > 0 && (
                <Link
                  href="/booth"
                  onClick={() => setPicker(null)}
                  className="tap-target mb-3 flex min-h-11 w-full items-center px-1 text-sm text-rz-hint active:text-rz-muted"
                >
                  ดูบูธที่ปิดแล้ว ({closedBoothCount}) →
                </Link>
              )}

              <button
                type="button"
                onClick={() => setPicker(null)}
                disabled={switching}
                className="tap-target min-h-11 w-full py-2 text-sm font-medium text-rz-hint"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}

      {picker === "project" && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-picker-title"
          onClick={() => !switching && setPicker(null)}
        >
          <div
            className="flex max-h-[80dvh] w-full max-w-sm flex-col rounded-2xl border-[0.5px] border-rz-border bg-rz-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 p-4 pb-3">
              <h2 id="project-picker-title" className="text-lg font-medium text-rz-text">
                เลือกองค์กร
              </h2>
              <p className="mt-1 text-sm text-rz-muted">เลือกองค์กรระยะยาวที่เปิดอยู่</p>

              {error && (
                <p className="mt-3 text-sm text-rz-red" role="alert">
                  {error}
                </p>
              )}

              <Link
                href="/projects/new"
                onClick={() => setPicker(null)}
                className="tap-target mt-4 flex min-h-11 w-full items-center justify-center rounded-[12px] border-[0.5px] border-rz-purple-border bg-rz-purple-bg text-sm font-medium text-rz-purple active:opacity-90"
              >
                ＋ สร้างองค์กรใหม่
              </Link>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4">
              <ul className="divide-y divide-rz-border border-t-[0.5px] border-rz-border">
                {loading && (
                  <li className="px-2 py-3 text-sm text-rz-hint">กำลังโหลดองค์กร…</li>
                )}

                {!loading &&
                  openOrgs.map((p) => {
                    const label = orgDisplayName(p);
                    const isActive = mode === "project" && projectId === p.id;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          disabled={switching}
                          onClick={() => patchContext({ mode: "project", projectId: p.id })}
                          className={`tap-target min-h-11 w-full px-2 py-3 text-left disabled:opacity-40 ${
                            isActive ? "text-rz-purple" : "text-rz-text"
                          }`}
                        >
                          <span className="block text-sm font-medium">{label}</span>
                          {p.orgName && p.name !== p.orgName && (
                            <span className="mt-0.5 block truncate text-xs text-rz-hint">
                              {p.name}
                            </span>
                          )}
                          {isActive && " ✓"}
                        </button>
                      </li>
                    );
                  })}

                {!loading && projects !== null && openOrgs.length === 0 && (
                  <li className="px-2 py-4 text-center text-sm text-rz-hint">
                    ยังไม่มีองค์กรระยะยาวที่เปิดอยู่
                  </li>
                )}
              </ul>
            </div>

            <div className="shrink-0 border-t-[0.5px] border-rz-border p-4 pt-3">
              <Link
                href="/projects"
                onClick={() => setPicker(null)}
                className="tap-target mb-3 flex min-h-11 w-full items-center px-1 text-sm text-rz-hint active:text-rz-muted"
              >
                ดูโครงการทั้งหมด →
              </Link>

              <button
                type="button"
                onClick={() => setPicker(null)}
                disabled={switching}
                className="tap-target min-h-11 w-full py-2 text-sm font-medium text-rz-hint"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
