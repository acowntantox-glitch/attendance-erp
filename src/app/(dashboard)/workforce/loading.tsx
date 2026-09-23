export default function WorkforceLoading() {
  return (
    <div className="space-y-6">
      <div className="h-6 w-32 animate-pulse rounded bg-slate-200" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
        ))}
      </div>
    </div>
  );
}
