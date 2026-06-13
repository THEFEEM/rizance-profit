"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthButton } from "@/components/auth/AuthButton";
import { AuthField } from "@/components/auth/AuthField";
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon } from "@/components/auth/auth-icons";
import { apiFetch } from "@/lib/api-client";
import type { User } from "@/types";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[] | undefined>>({});
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFields({});
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
      setFields(res.fields ?? {});
      setSubmitting(false);
    }
  }

  const showGlobalError = Boolean(error && !fields.email && !fields.password);

  return (
    <form onSubmit={onSubmit} className="flex flex-col" noValidate>
      <p className="mb-4 text-center text-xs font-medium text-rz-muted">Sign in</p>

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

      {showGlobalError && (
        <p
          className="mt-3 rounded-[11px] border-[0.5px] border-rz-red/40 bg-rz-red/10 px-4 py-3 text-sm text-rz-red"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="mt-[22px]">
        <AuthButton type="submit" disabled={submitting}>
          {submitting ? "Logging in…" : "Log in"}
        </AuthButton>
      </div>

      <p className="mt-6 text-center text-sm text-rz-hint">
        New here?{" "}
        <Link href="/register" className="font-medium text-rz-green">
          Create shop →
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

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}
