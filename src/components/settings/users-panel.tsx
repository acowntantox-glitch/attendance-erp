"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ManagedUser } from "@/domains/auth/user-management.service";

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

type Pending = { kind: "status"; user: ManagedUser; active: boolean } | { kind: "reset"; user: ManagedUser };

/**
 * Users & Access. Every button here is only a convenience: the API re-checks `user.manage`, the
 * company, the role hierarchy and self-action on each call, so a hidden or enabled button changes
 * nothing about what is allowed.
 */
export function UsersPanel({ users }: { users: ManagedUser[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<{ name: string; password: string } | null>(null);

  function close() {
    setPending(null);
    setError(null);
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      if (pending.kind === "status") {
        const response = await fetch(`/api/users/${pending.user.userId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: pending.active }),
        });
        if (!response.ok) {
          setError(await errorMessage(response, "Unable to update the user."));
          return;
        }
        close();
        router.refresh();
      } else {
        const response = await fetch(`/api/users/${pending.user.userId}/reset-password`, { method: "POST" });
        if (!response.ok) {
          setError(await errorMessage(response, "Unable to reset the password."));
          return;
        }
        const body = await response.json();
        setTemporaryPassword({ name: pending.user.fullName, password: body.data.temporaryPassword });
        close();
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users &amp; Access</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.userId}>
                <TableCell className="font-medium text-slate-900">
                  {user.fullName}
                  {user.isSelf && <span className="ml-2 text-xs font-normal text-slate-500">(you)</span>}
                  {user.employeeNumber && <div className="font-mono text-xs font-normal text-slate-500">{user.employeeNumber}</div>}
                </TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.role.replaceAll("_", " ")}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {user.accountDisabled ? (
                      <Badge variant="danger">Disabled</Badge>
                    ) : user.membershipActive ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="neutral">Inactive</Badge>
                    )}
                    {user.mustChangePassword && <Badge variant="warning">Must change password</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  {user.canManage ? (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setPending({ kind: "status", user, active: !user.membershipActive })}>
                        {user.membershipActive ? "Deactivate" : "Activate"}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setPending({ kind: "reset", user })}>
                        Reset password
                      </Button>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-slate-500">
                  No users found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === "reset" ? "Reset password" : pending?.kind === "status" && pending.active ? "Activate user" : "Deactivate user"}
            </DialogTitle>
          </DialogHeader>
          {pending && (
            <div className="space-y-3 text-sm text-slate-700">
              {error && (
                <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
                  {error}
                </div>
              )}
              {pending.kind === "reset" ? (
                <p>
                  Generate a one-time temporary password for <strong>{pending.user.fullName}</strong>. They are signed out everywhere and must choose their own
                  password at next sign-in. You will see the temporary password once.
                </p>
              ) : pending.active ? (
                <p>
                  Restore <strong>{pending.user.fullName}</strong>&apos;s access to this company.
                </p>
              ) : (
                <p>
                  <strong>{pending.user.fullName}</strong> will be signed out immediately and unable to sign in to this company. Their records and history are kept.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="button" onClick={confirm} disabled={busy}>
              {busy ? "Working…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={temporaryPassword !== null} onOpenChange={(open) => !open && setTemporaryPassword(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Temporary password</DialogTitle>
          </DialogHeader>
          {temporaryPassword && (
            <div className="space-y-3 text-sm text-slate-700">
              <p>
                Give this to <strong>{temporaryPassword.name}</strong> through a secure channel. It is shown <strong>only once</strong> and cannot be retrieved later.
              </p>
              <p className="select-all rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-center font-mono text-base tracking-wide text-slate-900">
                {temporaryPassword.password}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" onClick={() => setTemporaryPassword(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
