"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthButton } from "@/components/auth/AuthButton";
import { AuthDivider } from "@/components/auth/AuthDivider";
import { AuthField } from "@/components/auth/AuthField";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { RegisterModeTiles } from "@/components/auth/RegisterModeTiles";
import {
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MailIcon,
  StoreIcon,
  UserIcon,
} from "@/components/auth/auth-icons";
import { apiFetch } from "@/lib/api-client";
import type { RegisterMode } from "@/lib/register-mode";
import { registerNameField, registerSubmitButtonClass } from "@/lib/register-mode";
import type { User } from "@/types";

export function RegisterForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();

  const [mode, setMode] = useState<RegisterMode>("personal");
  const [shopName, setShopName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[] | undefined>>({});
  const [submitting, setSubmitting] = useState(false);

  const nameField = registerNameField(mode);
  const NameIcon = mode === "personal" ? UserIcon : StoreIcon;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorCode(null);
    setFields({});
    setSubmitting(true);
    const res = await apiFetch<{ user: User; redirect: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ shopName, email, password, mode }),
    });
    if (res.ok) {
      router.replace(res.data.redirect || "/");
      router.refresh();
    } else {
      setError(res.message);
      setErrorCode(res.code ?? null);
      setFields(res.fields ?? {});
      setSubmitting(false);
    }
  }

  const showGlobalError = Boolean(
    error && !fields.shopName && !fields.email && !fields.password,
  );
  const isGoogleAccountExists = errorCode === "google_account_exists";

  return (
    <form onSubmit={onSubmit} className="flex flex-col" noValidate>
      <p className="mb-4 text-center text-xs font-medium text-rz-muted">สร้างบัญชี Rizance</p>

      {googleEnabled && (
        <>
          <GoogleSignInButton label="สมัครด้วย Google" />
          <AuthDivider />
        </>
      )}

      <p className="mb-2.5 text-sm font-medium text-rz-text">เลือกโหมดการใช้งาน</p>
      <RegisterModeTiles value={mode} onChange={setMode} />

      <div className="mt-5 flex flex-col gap-3.5">
        <AuthField
          label={nameField.label}
          autoComplete={mode === "personal" ? "name" : "organization"}
          placeholder={nameField.placeholder}
          value={shopName}
          onChange={(e) => setShopName(e.target.value)}
          error={fields.shopName?.[0]}
          leadingIcon={<NameIcon />}
          required
        />

        <AuthField
          label="อีเมล"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          placeholder="email@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fields.email?.[0]}
          leadingIcon={<MailIcon />}
          required
        />

        <AuthField
          label="รหัสผ่าน"
          type={showPw ? "text" : "password"}
          autoComplete="new-password"
          placeholder="8 ตัวขึ้นไป"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fields.password?.[0]}
          leadingIcon={<LockIcon />}
          trailing={
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              aria-label={showPw ? "Hide password" : "Show password"}
              className="tap-target absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-rz-hint active:bg-rz-elevated"
            >
              {showPw ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          }
          required
        />
      </div>

      {showGlobalError && (
        <p
          className={`mt-3 rounded-[11px] border-[0.5px] px-4 py-3 text-sm ${
            isGoogleAccountExists
              ? "border-rz-border bg-rz-elevated text-rz-text"
              : "border-rz-red/40 bg-rz-red/10 text-rz-red"
          }`}
          role="alert"
        >
          {error}
          {isGoogleAccountExists && googleEnabled && (
            <span className="mt-2 block text-rz-hint">
              ใช้ปุ่ม &quot;สมัครด้วย Google&quot; ด้านบนแทน
            </span>
          )}
        </p>
      )}

      <div className="mt-[22px]">
        <AuthButton
          type="submit"
          disabled={submitting}
          className={registerSubmitButtonClass(mode)}
        >
          {submitting ? "กำลังสร้าง…" : "สร้างบัญชี"}
        </AuthButton>
      </div>

      <p className="mt-6 text-center text-sm text-rz-hint">
        มีบัญชีแล้ว?{" "}
        <Link href="/login" className="font-medium text-rz-green">
          เข้าสู่ระบบ →
        </Link>
      </p>
    </form>
  );
}
