"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProfileModeSection } from "@/components/profile/ProfileModeSection";
import { ShopMemberEditor } from "@/components/shop/ShopMemberEditor";
import { UserAvatar } from "@/components/UserAvatar";
import { apiFetch } from "@/lib/api-client";
import { CONTACT_CHANNELS } from "@/lib/contact-channels";
import { getAppVersionLabel } from "@/lib/app-version";
import type { AuthProvider } from "@/types";
import type { ShopMember } from "@/types/shop";
import type { User } from "@/types";

function authProviderBadge(provider: AuthProvider): string | null {
  if (provider === "google") return "เข้าสู่ระบบด้วย Google";
  if (provider === "both") return "อีเมล + Google";
  return null;
}

export function ProfilePageContent({
  user,
  mode,
  boothId,
  boothName,
  projectId,
  shopMembers = [],
}: {
  user: User;
  mode: "regular" | "booth" | "project" | "personal";
  boothId?: string;
  boothName?: string;
  projectId?: string;
  shopMembers?: ShopMember[];
}) {
  const router = useRouter();
  const [name, setName] = useState(user.shopName);
  const profileLabel = user.displayName || name;
  const providerBadge = authProviderBadge(user.authProvider);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user.shopName);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);

  async function saveName() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setNameError("กรุณาระบุชื่อ");
      return;
    }
    if (trimmed === name) {
      setEditing(false);
      return;
    }

    setSaving(true);
    setNameError(null);
    const res = await apiFetch<{ user: User }>("/api/user", {
      method: "PATCH",
      body: JSON.stringify({ shopName: trimmed }),
    });
    setSaving(false);

    if (res.ok) {
      setName(res.data.user.shopName);
      setDraft(res.data.user.shopName);
      setEditing(false);
      router.refresh();
    } else {
      setNameError(res.fields?.shopName?.[0] ?? res.message);
    }
  }

  function cancelEdit() {
    setDraft(name);
    setNameError(null);
    setEditing(false);
  }

  async function logout() {
    setLogoutBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="px-4 pb-8 pt-4" data-context="profile">
      <div className="flex flex-col items-center text-center">
        <UserAvatar name={profileLabel} avatarUrl={user.avatarUrl} size="lg" brandFallback />

        <div className="mt-4 w-full max-w-xs">
          {editing ? (
            <div className="space-y-2">
              <label className="sr-only" htmlFor="profile-name">
                ชื่อ
              </label>
              <input
                id="profile-name"
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={120}
                disabled={saving}
                className="w-full rounded-[12px] border-[0.5px] border-rz-border bg-rz-elevated px-3 py-2.5 text-center text-base font-medium text-rz-text outline-none focus:border-rz-green"
                autoFocus
              />
              {nameError && (
                <p className="text-sm text-rz-red" role="alert">
                  {nameError}
                </p>
              )}
              <div className="flex justify-center gap-2">
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="tap-target rounded-full px-4 py-2 text-sm text-rz-hint"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={saveName}
                  disabled={saving}
                  className="tap-target rounded-full bg-rz-green px-4 py-2 text-sm font-medium text-rz-bg disabled:opacity-50"
                >
                  {saving ? "กำลังบันทึก…" : "บันทึก"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-lg font-medium text-rz-text">{name}</h1>
              <button
                type="button"
                onClick={() => {
                  setDraft(name);
                  setEditing(true);
                }}
                className="tap-target rounded-full px-2 py-1 text-sm text-rz-hint active:text-rz-muted"
                aria-label="แก้ไขชื่อ"
              >
                ✏️
              </button>
            </div>
          )}
        </div>

        <p className="mt-1 text-sm text-rz-muted">{user.email}</p>
        {providerBadge && (
          <span className="mt-2 inline-flex items-center rounded-full border-[0.5px] border-rz-border bg-rz-elevated px-3 py-1 text-xs text-rz-muted">
            {providerBadge}
          </span>
        )}
        {user.displayName && user.displayName !== name && (
          <p className="mt-1 text-xs text-rz-hint">{user.displayName}</p>
        )}
      </div>

      <div className="mt-8 space-y-4">
        <section className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
          <h2 className="border-b-[0.5px] border-rz-border px-4 py-3 text-sm font-medium text-rz-text">
            บัญชีผู้ใช้
          </h2>
          <dl className="divide-y divide-rz-border text-sm">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <dt className="text-rz-muted">ชื่อ</dt>
              <dd className="truncate font-medium text-rz-text">{name}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <dt className="text-rz-muted">อีเมล</dt>
              <dd className="truncate text-rz-text">{user.email}</dd>
            </div>
            {providerBadge && (
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <dt className="text-rz-muted">การเข้าสู่ระบบ</dt>
                <dd className="text-rz-text">{providerBadge}</dd>
              </div>
            )}
            {user.authProvider !== "google" && (
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <dt className="text-rz-muted">รหัสผ่าน</dt>
                <dd className="text-rz-hint">••••••••</dd>
              </div>
            )}
          </dl>
        </section>

        <ProfileModeSection
          mode={mode}
          shopName={name}
          boothId={boothId}
          boothName={boothName}
          projectId={projectId}
        />

        {(mode === "regular" || mode === "booth") && (
          <ShopMemberEditor members={shopMembers} currency={user.currency} />
        )}

        <section className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
          <h2 className="border-b-[0.5px] border-rz-border px-4 py-3 text-sm font-medium text-rz-text">
            อื่นๆ
          </h2>
          <p className="border-b-[0.5px] border-rz-border px-4 py-3 text-sm text-rz-muted">
            📋 เกี่ยวกับแอป {getAppVersionLabel()}
          </p>
        </section>

        <section className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
          <h2 className="border-b-[0.5px] border-rz-border px-4 py-3 text-sm font-medium text-rz-text">
            ติดต่อเรา
          </h2>
          <ul className="divide-y divide-rz-border">
            {CONTACT_CHANNELS.map((channel) => (
              <li key={channel.id}>
                <a
                  href={channel.href}
                  target={channel.href.startsWith("http") ? "_blank" : undefined}
                  rel={channel.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  className="flex items-center gap-3 px-4 py-3 text-sm active:bg-rz-elevated"
                >
                  <span className="text-base" aria-hidden>
                    {channel.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-rz-muted">{channel.label}</span>
                    <span className="block truncate text-rz-text">{channel.value}</span>
                  </span>
                  <span className="text-rz-hint" aria-hidden>
                    ›
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <button
          type="button"
          onClick={logout}
          disabled={logoutBusy}
          className="tap-target flex min-h-12 w-full items-center justify-center rounded-[14px] border-[0.5px] border-rz-border bg-rz-card text-sm font-medium text-rz-red active:bg-rz-elevated disabled:opacity-50"
        >
          {logoutBusy ? "กำลังออก…" : "🚪 ออกจากระบบ"}
        </button>
      </div>
    </div>
  );
}
