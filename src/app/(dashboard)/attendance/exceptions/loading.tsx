export default function AttendanceExceptionsLoading() {
  return (
    <div className="space-y-6">
      <div className="h-6 w-64 animate-pulse rounded bg-slate-200" />
      <div className="h-32 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
    </div>
  );
}
