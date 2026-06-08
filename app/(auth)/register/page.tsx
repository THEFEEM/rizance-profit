"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { apiFetch } from "@/lib/api-client";
import type { User } from "@/types";

export default function RegisterPage() {
  const router = useRouter();

  const [shopName, setShopName] = useState("");
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
    const res = await apiFetch<{ user: User }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ shopName, email, password }),
    });
    if (res.ok) {
      router.replace("/");
      router.refresh();
    } else {
      setError(res.message);
      setFields(res.fields ?? {});
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Input
        label="Shop name"
        placeholder="Bean & Brew"
        value={shopName}
        onChange={(e) => setShopName(e.target.value)}
        error={fields.shopName?.[0]}
        required
      />
      <Input
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        placeholder="you@shop.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fields.email?.[0]}
        required
      />
      <div className="relative">
        <Input
          label="Password"
          type={showPw ? "text" : "password"}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fields.password?.[0]}
          required
        />
        <button
          type="button"
          onClick={() => setShowPw((s) => !s)}
          className="absolute right-3 top-9 text-sm font-medium text-slate-500"
          tabIndex={-1}
        >
          {showPw ? "Hide" : "Show"}
        </button>
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create shop"}
      </Button>

      <p className="mt-2 text-center text-slate-600">
        Already have a shop?{" "}
        <Link href="/login" className="font-semibold text-emerald-700">
          Log in →
        </Link>
      </p>
    </form>
  );
}
