export default function AppLoading() {
  return (
    <div className="animate-pulse px-4 pt-3">
      <div className="h-[140px] rounded-[14px] border-[0.5px] border-rz-border bg-rz-card" />
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <div className="h-[72px] rounded-[14px] border-[0.5px] border-rz-border bg-rz-card" />
        <div className="h-[72px] rounded-[14px] border-[0.5px] border-rz-border bg-rz-card" />
      </div>
      <div className="mt-3 h-24 rounded-[14px] border-[0.5px] border-rz-border bg-rz-card" />
    </div>
  );
}
