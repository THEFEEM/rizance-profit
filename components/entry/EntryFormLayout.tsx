/** Scrollable fields above a sticky amount + numpad section. */
export function EntryFormLayout({
  children,
  pad,
  className = "",
  dataContext,
}: {
  children: React.ReactNode;
  pad: React.ReactNode;
  className?: string;
  dataContext?: string;
}) {
  return (
    <div
      className={`flex h-[calc(100dvh-57px-61px)] flex-col overflow-hidden ${className}`}
      {...(dataContext ? { "data-context": dataContext } : {})}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {pad}
    </div>
  );
}
