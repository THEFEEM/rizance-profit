import { AuthBrand } from "@/components/auth/AuthBrand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center bg-rz-bg px-6 py-10 pb-[env(safe-area-inset-bottom)]">
      <AuthBrand />
      <div className="mt-8">{children}</div>
    </main>
  );
}
