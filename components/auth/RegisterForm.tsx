"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthButton } from "@/components/auth/AuthButton";
import { AuthDivider } from "@/components/auth/AuthDivider";
import { AuthField } from "@/components/auth/AuthField";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import {
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MailIcon,
  StoreIcon,
} from "@/components/auth/auth-icons";
import { apiFetch } from "@/lib/api-client";
import type { User } from "@/types";

export function RegisterForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();

  const [shopName, setShopName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[] | undefined>>({});
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorCode(null);
    setFields({});
    setSubmitting(true);
    const res = await apiFetch<{ user: User }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ shopName, email, password }),
    });
    if (res.ok) {
      router.replace("/");
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
      <p className="mb-4 text-center text-xs font-medium text-rz-muted">Create shop</p>

      {googleEnabled && (
        <>
          <GoogleSignInButton />
          <AuthDivider />
        </>
      )}

      <div className="flex flex-col gap-3.5">
        <AuthField
          label="Shop name"
          autoComplete="organization"
          placeholder="Bean & Brew"
          value={shopName}
          onChange={(e) => setShopName(e.target.value)}
          error={fields.shopName?.[0]}
          leadingIcon={<StoreIcon />}
          required
        />

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
          autoComplete="new-password"
          placeholder="At least 8 characters"
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
              ใช้ปุ่ม &quot;เข้าสู่ระบบด้วย Google&quot; ด้านบนแทน
            </span>
          )}
        </p>
      )}

      <div className="mt-[22px]">
        <AuthButton type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create shop"}
        </AuthButton>
      </div>

      <p className="mt-6 text-center text-sm text-rz-hint">
        Already have a shop?{" "}
        <Link href="/login" className="font-medium text-rz-green">
          Log in →
        </Link>
      </p>
    </form>
  );
}
