import { getRequestContext } from "@/lib/auth/request-context";
import { AttendanceModuleNav } from "@/components/attendance/attendance-module-nav";

/**
 * Shared shell for the whole Attendance module: the horizontal module navigation above whichever
 * Attendance page is open (Overview, Calendar, Issues & Corrections, Reports, Settings, and the
 * self-service `/attendance` page). Being a layout it renders once and persists across navigation
 * between these pages, and it sits above their `loading`/`error` boundaries so the bar stays put.
 *
 * It grants and enforces nothing. The role only decides which tabs to show; each page and service
 * still enforces its own permission. If the request context cannot be resolved (no session, or a
 * forced password change) this renders no navigation and the parent dashboard layout / the pages
 * handle the redirect exactly as before.
 */
export default async function AttendanceLayout({ children }: { children: React.ReactNode }) {
  let role;
  try {
    role = (await getRequestContext()).role;
  } catch {
    role = null;
  }

  return (
    <div className="space-y-6">
      {role && <AttendanceModuleNav role={role} />}
      {children}
    </div>
  );
}
