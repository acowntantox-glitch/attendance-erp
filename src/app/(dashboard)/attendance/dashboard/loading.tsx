export default function AttendanceDashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="h-6 w-64 motion-safe:animate-pulse rounded bg-slate-200" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-20 motion-safe:animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
        ))}
      </div>
      <div className="h-48 motion-safe:animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
      <div className="h-48 motion-safe:animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
    </div>
  );
}
