"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ModeRow } from "@/components/ModeRow";
import { apiFetch } from "@/lib/api-client";
import { activeOrgProjects } from "@/lib/mode-switch";
import { orgDisplayName } from "@/lib/project-ui";
import type { Booth } from "@/types/booth";
import type { AppContext } from "@/types/context";
import type { ProjectListItem } from "@/types/project";

type SwitcherMode = "regular" | "booth" | "project" | "personal";
type PickerView = "main" | "booth";

export function ModePicker({
  open,
  onClose,
  mode,
  shopName,
  boothId,
  boothName,
  projectId,
  projectName,
  orgName,
}: {
  open: boolean;
  onClose: () => void;
  mode: SwitcherMode;
  shopName: string;
  boothId?: string;
  boothName?: string;
  projectId?: string;
  projectName?: string;
  orgName?: string | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<PickerView>("main");
  const [booths, setBooths] = useState<Booth[] | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setView("main");
    setError(null);
    setBooths(null);
    setProjects(null);

    let cancelled = false;
    (async () => {
      setLoading(true);
      const [boothRes, projectRes] = await Promise.all([
        apiFetch<Booth[]>("/api/booths"),
        apiFetch<ProjectListItem[]>("/api/projects"),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (boothRes.ok) setBooths(boothRes.data);
      else {
        setError(boothRes.message);
        setBooths([]);
      }
      if (projectRes.ok) setProjects(projectRes.data);
      else {
        setError(projectRes.message);
        setProjects([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

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
      | { mode: "personal" }
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
      onClose();
      if (body.mode === "project" || mode === "project") router.push("/");
      router.refresh();
    } else {
      setError(res.message);
    }
  }

  async function selectShop() {
    if (mode === "regular" || switching) return;
    await patchContext({ mode: "regular" });
  }

  async function selectPersonal() {
    if (mode === "personal" || switching) return;
    await patchContext({ mode: "personal" });
  }

  async function selectBooth() {
    if (switching) return;
    const list = booths ?? (await loadBooths());
    const openBooths = list.filter((b) => b.status === "open");
    if (openBooths.length === 0) return;
    if (openBooths.length === 1) {
      if (mode === "booth" && boothId === openBooths[0].id) return;
      await patchContext({ mode: "booth", boothId: openBooths[0].id });
      return;
    }
    setView("booth");
    setError(null);
  }

  async function selectOrg() {
    if (switching) return;
    const list = projects ?? (await loadProjects());
    const orgs = activeOrgProjects(list);
    if (orgs.length === 0) return;
    const target = orgs.find((o) => o.id === projectId) ?? orgs[0];
    if (mode === "project" && projectId === target.id) return;
    await patchContext({ mode: "project", projectId: target.id });
  }

  function close() {
    if (!switching) onClose();
  }

  if (!open) return null;

  const openBooths = booths?.filter((b) => b.status === "open") ?? [];
  const closedBoothCount = booths?.filter((b) => b.status === "closed").length ?? 0;
  const orgs = activeOrgProjects(projects ?? []);
  const org = orgs.find((o) => o.id === projectId) ?? orgs[0];
  const orgLabel = org ? orgDisplayName({ orgName: org.orgName, name: org.name }) : null;

  const boothRowLabel =
    mode === "booth" && boothName
      ? boothName
      : openBooths.length === 1
        ? openBooths[0].name
        : openBooths.length > 1
          ? "เลือกงานบูธ"
          : "งานบูธ";

  if (view === "booth") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mode-picker-booth-title"
        onClick={close}
      >
        <div
          className="flex max-h-[80dvh] w-full max-w-sm flex-col rounded-2xl border-[0.5px] border-rz-border bg-rz-card shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="shrink-0 p-4 pb-3">
            <h2 id="mode-picker-booth-title" className="text-lg font-medium text-rz-text">
              เลือกงานบูธ
            </h2>
            <p className="mt-1 text-sm text-rz-muted">เลือกงานบูธที่เปิดอยู่</p>
            {error && (
              <p className="mt-3 text-sm text-rz-red" role="alert">
                {error}
              </p>
            )}
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
                onClick={close}
                className="tap-target mb-3 flex min-h-11 w-full items-center px-1 text-sm text-rz-hint active:text-rz-muted"
              >
                ดูบูธที่ปิดแล้ว ({closedBoothCount}) →
              </Link>
            )}
            <button
              type="button"
              onClick={() => setView("main")}
              disabled={switching}
              className="tap-target min-h-11 w-full py-2 text-sm font-medium text-rz-hint"
            >
              กลับ
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mode-picker-title"
      onClick={close}
    >
      <div
        className="flex max-h-[85dvh] w-full max-w-sm flex-col rounded-2xl border-[0.5px] border-rz-border bg-rz-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 p-4 pb-3">
          <h2 id="mode-picker-title" className="text-lg font-medium text-rz-text">
            เลือกโหมด
          </h2>
          {error && (
            <p className="mt-3 text-sm text-rz-red" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <ul className="divide-y divide-rz-border border-t-[0.5px] border-rz-border">
            <ModeRow
              icon="❤️"
              label="บุคคล"
              selected={mode === "personal"}
              disabled={switching}
              onClick={selectPersonal}
            />
            <ModeRow
              icon="💚"
              label={shopName}
              selected={mode === "regular"}
              disabled={switching}
              onClick={selectShop}
            />
            {openBooths.length > 0 && (
              <ModeRow
                icon="🧡"
                label={boothRowLabel}
                sublabel="บูธ"
                selected={mode === "booth"}
                disabled={switching || loading}
                onClick={selectBooth}
              />
            )}
            {orgLabel && (
              <ModeRow
                icon="💜"
                label={orgLabel}
                sublabel="องค์กร"
                selected={mode === "project"}
                disabled={switching || loading}
                onClick={selectOrg}
              />
            )}
            {loading && booths === null && projects === null && (
              <li className="px-2 py-3 text-sm text-rz-hint">กำลังโหลด…</li>
            )}
          </ul>

          <div className="my-4 border-t-[0.5px] border-rz-border pt-3">
            <Link
              href="/profile"
              onClick={close}
              className="tap-target flex min-h-11 w-full items-center px-2 text-sm font-medium text-rz-muted active:text-rz-text"
            >
              ＋ สร้างร้านใหม่
            </Link>
            <Link
              href="/booth/new"
              onClick={close}
              className="tap-target flex min-h-11 w-full items-center px-2 text-sm font-medium text-rz-muted active:text-rz-text"
            >
              ＋ สร้างบูธใหม่
            </Link>
            {orgs.length === 0 && (
              <Link
                href="/projects/new"
                onClick={close}
                className="tap-target flex min-h-11 w-full items-center px-2 text-sm font-medium text-rz-muted active:text-rz-text"
              >
                ＋ สร้างองค์กร
              </Link>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t-[0.5px] border-rz-border p-4 pt-3">
          <button
            type="button"
            onClick={close}
            disabled={switching}
            className="tap-target min-h-11 w-full py-2 text-sm font-medium text-rz-hint"
          >
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
