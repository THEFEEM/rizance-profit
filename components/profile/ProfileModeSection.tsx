"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ModeRow } from "@/components/ModeRow";
import { renderModeIcon } from "@/components/mode-icons";
import { apiFetch } from "@/lib/api-client";
import { SHOW_ORG_MODE, SHOW_PERSONAL_MODE } from "@/lib/feature-flags";
import { activeOrgProjects } from "@/lib/mode-switch";
import { orgDisplayName } from "@/lib/project-ui";
import type { Booth } from "@/types/booth";
import type { AppContext } from "@/types/context";
import type { ProjectListItem } from "@/types/project";

type SwitcherMode = "regular" | "booth" | "project" | "personal";

export function ProfileModeSection({
  mode,
  shopName,
  boothId,
  boothName,
  projectId,
}: {
  mode: SwitcherMode;
  shopName: string;
  boothId?: string;
  boothName?: string;
  projectId?: string;
}) {
  const router = useRouter();
  const [booths, setBooths] = useState<Booth[] | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boothPickerOpen, setBoothPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const [boothRes, projectRes] = await Promise.all([
        apiFetch<Booth[]>("/api/booths"),
        apiFetch<ProjectListItem[]>("/api/projects"),
      ]);
      if (cancelled) return;
      setLoading(false);
      const errors: string[] = [];
      if (boothRes.ok) setBooths(boothRes.data);
      else {
        setBooths([]);
        errors.push(boothRes.message || "โหลดรายการบูธไม่สำเร็จ");
      }
      if (projectRes.ok) setProjects(projectRes.data);
      else {
        setProjects([]);
        errors.push(projectRes.message || "โหลดรายการโครงการไม่สำเร็จ");
      }
      if (errors.length > 0) setError(errors.join(" · "));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      setBoothPickerOpen(false);
      if (body.mode === "project" || mode === "project") router.push("/home");
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
    const openBooths = (booths ?? []).filter((b) => b.status === "open");
    if (openBooths.length === 0) return;
    if (openBooths.length === 1) {
      if (mode === "booth" && boothId === openBooths[0].id) return;
      await patchContext({ mode: "booth", boothId: openBooths[0].id });
      return;
    }
    setBoothPickerOpen((v) => !v);
  }

  async function selectOrg() {
    if (switching) return;
    const orgs = activeOrgProjects(projects ?? []);
    if (orgs.length === 0) return;
    const target = orgs.find((o) => o.id === projectId) ?? orgs[0];
    if (mode === "project" && projectId === target.id) return;
    await patchContext({ mode: "project", projectId: target.id });
  }

  const openBooths = booths?.filter((b) => b.status === "open") ?? [];
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

  return (
    <section className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
      <h2 className="border-b-[0.5px] border-rz-border px-4 py-3 text-sm font-medium text-rz-text">
        โหมดการใช้งาน
      </h2>

      {error && (
        <p className="px-4 pt-3 text-sm text-rz-red" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="px-4 py-6 text-center text-sm text-rz-hint">กำลังโหลด…</p>
      ) : (
        <>
          <ul className="divide-y divide-rz-border">
            {SHOW_PERSONAL_MODE && (
              <ModeRow
                icon={renderModeIcon("personal")}
                label="บุคคล"
                selected={mode === "personal"}
                disabled={switching}
                onClick={selectPersonal}
              />
            )}
            <ModeRow
              icon={renderModeIcon("regular")}
              label={shopName}
              sublabel="ร้านค้า"
              selected={mode === "regular"}
              disabled={switching}
              onClick={selectShop}
            />
            {openBooths.length > 0 ? (
              <ModeRow
                icon={renderModeIcon("booth")}
                label={boothRowLabel}
                sublabel="บูธ"
                selected={mode === "booth"}
                disabled={switching}
                onClick={selectBooth}
              />
            ) : (
              <li>
                <Link
                  href="/booth/new"
                  className="tap-target flex min-h-12 items-center gap-3 px-3 py-3 text-sm font-medium text-rz-text active:bg-rz-elevated"
                >
                  <span className="flex h-7 w-7 items-center justify-center" aria-hidden>
                    {renderModeIcon("booth")}
                  </span>
                  <span className="flex-1">บูธ</span>
                  <span className="shrink-0 text-xs text-rz-hint">สร้าง →</span>
                </Link>
              </li>
            )}
            {SHOW_ORG_MODE && orgLabel ? (
              <ModeRow
                icon={renderModeIcon("org")}
                label={orgLabel}
                sublabel="องค์กร"
                selected={mode === "project"}
                disabled={switching}
                onClick={selectOrg}
              />
            ) : SHOW_ORG_MODE ? (
              <li>
                <Link
                  href="/projects/new"
                  className="tap-target flex min-h-12 items-center gap-3 px-3 py-3 text-sm font-medium text-rz-text active:bg-rz-elevated"
                >
                  <span className="flex h-7 w-7 items-center justify-center" aria-hidden>
                    {renderModeIcon("org")}
                  </span>
                  <span className="flex-1">องค์กร</span>
                  <span className="shrink-0 text-xs text-rz-hint">สร้าง →</span>
                </Link>
              </li>
            ) : null}
          </ul>

          {boothPickerOpen && openBooths.length > 1 && (
            <ul className="border-t-[0.5px] border-rz-border bg-rz-elevated/40">
              {openBooths.map((b) => {
                const isActive = mode === "booth" && boothId === b.id;
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      disabled={switching}
                      onClick={() => patchContext({ mode: "booth", boothId: b.id })}
                      className={`tap-target min-h-11 w-full px-4 py-2.5 text-left text-sm disabled:opacity-40 ${
                        isActive ? "font-medium text-rz-amber" : "text-rz-text"
                      }`}
                    >
                      {b.name}
                      {isActive && " ✓"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
