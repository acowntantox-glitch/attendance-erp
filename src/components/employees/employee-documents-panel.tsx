"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DocumentExpiryStatus, EmployeeDocumentSummary } from "@/domains/employee/model";

const DOCUMENT_TYPES = [
  "EMPLOYMENT_CONTRACT",
  "PASSPORT",
  "EMIRATES_ID",
  "VISA",
  "CERTIFICATE",
  "OFFER_LETTER",
  "OTHER",
];

const EXPIRY_VARIANT: Record<DocumentExpiryStatus, NonNullable<BadgeProps["variant"]>> = {
  EXPIRED: "danger",
  EXPIRING_SOON: "warning",
  VALID: "success",
  NO_EXPIRY: "neutral",
};

const EXPIRY_LABEL: Record<DocumentExpiryStatus, string> = {
  EXPIRED: "Expired",
  EXPIRING_SOON: "Expiring soon",
  VALID: "Valid",
  NO_EXPIRY: "No expiry",
};

export function EmployeeDocumentsPanel({
  employeeId,
  documents,
  canManage,
}: {
  employeeId: string;
  documents: EmployeeDocumentSummary[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("OTHER");
  const [title, setTitle] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setError(null);

    const initiateResponse = await fetch(`/api/employees/${employeeId}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentType,
        title: title || file.name,
        originalFilename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        issueDate: issueDate || undefined,
        expiryDate: expiryDate || undefined,
      }),
    });

    if (!initiateResponse.ok) {
      const body = await initiateResponse.json().catch(() => null);
      setError(body?.error?.message ?? "Unable to start the upload.");
      setSubmitting(false);
      return;
    }

    const { data } = await initiateResponse.json();
    const putResponse = await fetch(data.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
    if (!putResponse.ok) {
      setError("The file could not be uploaded to storage.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setOpen(false);
    setFile(null);
    setTitle("");
    router.refresh();
  }

  async function handleArchive(documentId: string) {
    await fetch(`/api/employees/${employeeId}/documents/${documentId}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Upload Document</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Upload Document</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleUpload} className="space-y-4">
              {error && (
                <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              <div>
                <Label>Document Type</Label>
                <Select value={documentType} onValueChange={setDocumentType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type.replaceAll("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to filename" />
              </div>
              <div>
                <Label>File</Label>
                <input
                  type="file"
                  required
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Issue Date</Label>
                  <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                </div>
                <div>
                  <Label>Expiry Date</Label>
                  <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting || !file}>
                  {submitting ? "Uploading…" : "Upload"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {documents.length === 0 ? (
        <p className="text-sm text-slate-500">No documents uploaded yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{doc.title}</p>
                <p className="text-xs text-slate-400">
                  {doc.documentType.replaceAll("_", " ")} · {doc.originalFilename}
                  {doc.expiryDate ? ` · Expires ${doc.expiryDate}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={EXPIRY_VARIANT[doc.expiryStatus]}>{EXPIRY_LABEL[doc.expiryStatus]}</Badge>
                <a
                  href={`/api/employees/${employeeId}/documents/${doc.id}/download`}
                  className="text-sm text-blue-700 hover:underline"
                >
                  Download
                </a>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => handleArchive(doc.id)}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
