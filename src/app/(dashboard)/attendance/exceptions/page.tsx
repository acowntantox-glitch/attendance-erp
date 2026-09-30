import { redirect } from "next/navigation";
import { legacyRedirectUrl } from "@/components/attendance/issues/issues-navigation";

/**
 * Legacy URL, kept so bookmarks and shared links keep working. Exceptions now live in the
 * "Issues & Corrections" workspace; the query string (date range, types, filters, page) is carried
 * over unchanged. Authorization is enforced by the destination page and the exception service.
 */
export default async function LegacyAttendanceExceptionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(legacyRedirectUrl("exceptions", await searchParams));
}
