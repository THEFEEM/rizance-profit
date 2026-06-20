"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthButton } from "@/components/auth/AuthButton";
import { AuthDivider } from "@/components/auth/AuthDivider";
import { AuthField } from "@/components/auth/AuthField";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon } from "@/components/auth/auth-icons";
import { apiFetch } from "@/lib/api-client";
import type { User } from "@/types";

function AuthBanner({ children, variant = "error" }: { children: React.ReactNode; variant?: "error" | "info" }) {
  const styles =
    variant === "info"
      ? "border-rz-border bg-rz-elevated text-rz-text"
      : "border-rz-red/40 bg-rz-red/10 text-rz-red";
  return (
    <p className={`mt-3 rounded-[11px] border-[0.5px] px-4 py-3 text-sm ${styles}`} role="alert">
      {children}
    </p>
  );
}

function LoginFormInner({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const oauthError = params.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[] | undefined>>({});
  const [submitting, setSubmitting] = useState(false);
  const [googleFailedBanner, setGoogleFailedBanner] = useState(false);

  useEffect(() => {
    if (oauthError === "google_failed") {
      setGoogleFailedBanner(true);
    }
  }, [oauthError]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorCode(null);
    setFields({});
    setGoogleFailedBanner(false);
    setSubmitting(true);
    const res = await apiFetch<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      router.replace(next);
      router.refresh();
    } else {
      setError(res.message);
      setErrorCode(res.code ?? null);
      setFields(res.fields ?? {});
      setSubmitting(false);
    }
  }

  const showGlobalError = Boolean(error && !fields.email && !fields.password);
  const isGoogleOnly = errorCode === "google_only";

  return (
    <form onSubmit={onSubmit} className="flex flex-col" noValidate>
      <p className="mb-1 text-center text-sm font-medium text-rz-text">Welcome to Rizance</p>
      <p className="mb-4 text-center text-xs text-rz-muted">เข้าสู่ระบบ</p>

      {googleEnabled && (
        <>
          <GoogleSignInButton />
          <AuthDivider />
        </>
      )}

      <div className="flex flex-col gap-3.5">
        <AuthField
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fields.email?.[0]}
          leadingIcon={<MailIcon />}
          required
        />

        <AuthField
          label="Password"
          type={showPw ? "text" : "password"}
          autoComplete="current-password"
          placeholder="Password"
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

      {googleFailedBanner && (
        <AuthBanner>เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</AuthBanner>
      )}

      {showGlobalError && !isGoogleOnly && <AuthBanner>{error}</AuthBanner>}

      {isGoogleOnly && (
        <AuthBanner variant="info">
          {error}
          {googleEnabled && (
            <span className="mt-2 block text-rz-hint">ใช้ปุ่ม &quot;เข้าสู่ระบบด้วย Google&quot; ด้านบน</span>
          )}
        </AuthBanner>
      )}

      <div className="mt-[22px]">
        <AuthButton type="submit" disabled={submitting}>
          {submitting ? "Logging in…" : "Log in"}
        </AuthButton>
      </div>

      <p className="mt-6 text-center text-sm text-rz-hint">
        ยังไม่มีบัญชี?{" "}
        <Link href="/register" className="font-medium text-rz-green">
          สร้างบัญชี →
        </Link>
      </p>
    </form>
  );
}

function LoginFallback() {
  return (
    <div className="flex flex-col items-center gap-3 py-8" role="status">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-rz-border border-t-rz-green"
        aria-hidden
      />
      <p className="text-sm text-rz-hint">Loading…</p>
    </div>
  );
}

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginFormInner googleEnabled={googleEnabled} />
    </Suspense>
  );
}
