export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-10">
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Rizance Profit</h1>
        <p className="mt-1 text-slate-500">know your real profit</p>
      </div>
      {children}
    </main>
  );
}
