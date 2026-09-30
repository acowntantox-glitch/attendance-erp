import { redirect } from "next/navigation";
import { legacyRedirectUrl } from "@/components/attendance/issues/issues-navigation";

/**
 * Legacy URL, kept so bookmarks and shared links keep working. The HR correction queue now lives in
 * the "Issues & Corrections" workspace; the `status` filter is carried over unchanged.
 * Authorization is enforced by the destination page and the correction service.
 */
export default async function LegacyAttendanceCorrectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(legacyRedirectUrl("corrections", await searchParams));
}
