import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request-context";

export default async function RootPage() {
  let authenticated = false;
  try {
    await getRequestContext();
    authenticated = true;
  } catch {
    authenticated = false;
  }
  redirect(authenticated ? "/dashboard" : "/login");
}
