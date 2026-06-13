export default function SummaryLoading() {
  return (
    <div className="animate-pulse px-4 pt-3">
      <div className="flex items-center justify-between">
        <div className="h-6 w-16 rounded bg-rz-card" />
        <div className="h-4 w-28 rounded bg-rz-card" />
      </div>
      <div className="mt-3 h-10 rounded-full border-[0.5px] border-rz-border bg-rz-card" />
      <div className="mt-4 flex gap-2 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-9 w-20 shrink-0 rounded-full bg-rz-card" />
        ))}
      </div>
      <div className="mt-4 h-[148px] rounded-[14px] border-[0.5px] border-rz-border bg-rz-card" />
      <div className="mt-6 h-[200px] rounded-[14px] border-[0.5px] border-rz-border bg-rz-card" />
      <div className="mt-8 h-[220px] rounded-[14px] border-[0.5px] border-rz-border bg-rz-card" />
    </div>
  );
}
