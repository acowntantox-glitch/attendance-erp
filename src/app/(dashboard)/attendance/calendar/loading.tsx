export default function AttendanceCalendarLoading() {
  return (
    <div className="space-y-6">
      <div className="h-6 w-64 animate-pulse rounded bg-slate-200" />
      <div className="h-10 w-96 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-24 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
        ))}
      </div>
      <div className="h-96 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
    </div>
  );
}
