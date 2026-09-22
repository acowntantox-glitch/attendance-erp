"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Option = { id: string; name: string };

export type EmployeeFormValues = {
  firstName: string;
  middleName: string;
  lastName: string;
  preferredName: string;
  dateOfBirth: string;
  gender: string;
  nationality: string;
  personalEmail: string;
  workEmail: string;
  phone: string;
  alternatePhone: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  departmentId: string;
  designationId: string;
  locationId: string;
  managerId: string;
  employmentType: string;
  dateOfJoining: string;
  probationEndDate: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
};

const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "TEMPORARY", "FREELANCE"];

const EMPTY_VALUES: EmployeeFormValues = {
  firstName: "",
  middleName: "",
  lastName: "",
  preferredName: "",
  dateOfBirth: "",
  gender: "",
  nationality: "",
  personalEmail: "",
  workEmail: "",
  phone: "",
  alternatePhone: "",
  address: "",
  city: "",
  state: "",
  country: "",
  postalCode: "",
  departmentId: "",
  designationId: "",
  locationId: "",
  managerId: "",
  employmentType: "FULL_TIME",
  dateOfJoining: "",
  probationEndDate: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelationship: "",
};

const REQUIRED_FIELDS = new Set<keyof EmployeeFormValues>(["firstName", "lastName", "workEmail", "dateOfJoining"]);

/**
 * In edit mode, a blanked-out optional field must become explicit `null` (clear it server-side),
 * not `undefined` (omitted — which the update API treats as "leave unchanged"), since the form
 * always submits the full record. In create mode there's nothing to "clear," so blank optional
 * fields are simply omitted.
 */
function toApiPayload(values: EmployeeFormValues, mode: "create" | "edit"): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const trimmed = value.trim();
    if (trimmed !== "") {
      payload[key] = trimmed;
    } else if (mode === "edit" && !REQUIRED_FIELDS.has(key as keyof EmployeeFormValues)) {
      payload[key] = null;
    }
  }
  return payload;
}

export function EmployeeForm({
  mode,
  employeeId,
  initialValues,
  departments,
  designations,
  locations,
  managers,
}: {
  mode: "create" | "edit";
  employeeId?: string;
  initialValues?: Partial<EmployeeFormValues>;
  departments: Option[];
  designations: Option[];
  locations: Option[];
  managers: Option[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<EmployeeFormValues>({ ...EMPTY_VALUES, ...initialValues });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  function setField<K extends keyof EmployeeFormValues>(key: K, value: EmployeeFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const url = mode === "create" ? "/api/employees" : `/api/employees/${employeeId}`;
    const method = mode === "create" ? "POST" : "PATCH";

    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toApiPayload(values, mode)),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Unable to save this employee. Please check the form and try again.");
      setFieldErrors(body?.error?.details?.fieldErrors ?? {});
      setSubmitting(false);
      return;
    }

    const body = await response.json();
    router.push(`/employees/${body.data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextField label="First Name" value={values.firstName} onChange={(v) => setField("firstName", v)} required errors={fieldErrors.firstName} />
          <TextField label="Middle Name" value={values.middleName} onChange={(v) => setField("middleName", v)} />
          <TextField label="Last Name" value={values.lastName} onChange={(v) => setField("lastName", v)} required errors={fieldErrors.lastName} />
          <TextField label="Preferred Name" value={values.preferredName} onChange={(v) => setField("preferredName", v)} />
          <TextField label="Date of Birth" type="date" value={values.dateOfBirth} onChange={(v) => setField("dateOfBirth", v)} />
          <TextField label="Gender" value={values.gender} onChange={(v) => setField("gender", v)} />
          <TextField label="Nationality" value={values.nationality} onChange={(v) => setField("nationality", v)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact Information</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextField
            label="Work Email"
            type="email"
            value={values.workEmail}
            onChange={(v) => setField("workEmail", v)}
            required
            errors={fieldErrors.workEmail}
          />
          <TextField label="Personal Email" type="email" value={values.personalEmail} onChange={(v) => setField("personalEmail", v)} />
          <TextField label="Phone" value={values.phone} onChange={(v) => setField("phone", v)} />
          <TextField label="Alternate Phone" value={values.alternatePhone} onChange={(v) => setField("alternatePhone", v)} />
          <TextField label="Address" value={values.address} onChange={(v) => setField("address", v)} />
          <TextField label="City" value={values.city} onChange={(v) => setField("city", v)} />
          <TextField label="State" value={values.state} onChange={(v) => setField("state", v)} />
          <TextField label="Country" value={values.country} onChange={(v) => setField("country", v)} />
          <TextField label="Postal Code" value={values.postalCode} onChange={(v) => setField("postalCode", v)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Employment Information</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextField
            label="Date of Joining"
            type="date"
            value={values.dateOfJoining}
            onChange={(v) => setField("dateOfJoining", v)}
            required
            errors={fieldErrors.dateOfJoining}
          />
          <SelectField
            label="Employment Type"
            value={values.employmentType}
            onChange={(v) => setField("employmentType", v)}
            options={EMPLOYMENT_TYPES.map((t) => ({ id: t, name: t.replaceAll("_", " ") }))}
          />
          <TextField label="Probation End Date" type="date" value={values.probationEndDate} onChange={(v) => setField("probationEndDate", v)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Organization Assignment</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SelectField label="Department" value={values.departmentId} onChange={(v) => setField("departmentId", v)} options={departments} clearable />
          <SelectField label="Designation" value={values.designationId} onChange={(v) => setField("designationId", v)} options={designations} clearable />
          <SelectField label="Location" value={values.locationId} onChange={(v) => setField("locationId", v)} options={locations} clearable />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reporting Manager</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SelectField label="Manager" value={values.managerId} onChange={(v) => setField("managerId", v)} options={managers} clearable errors={fieldErrors.managerId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Emergency Contact</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextField label="Name" value={values.emergencyContactName} onChange={(v) => setField("emergencyContactName", v)} />
          <TextField label="Phone" value={values.emergencyContactPhone} onChange={(v) => setField("emergencyContactPhone", v)} />
          <TextField label="Relationship" value={values.emergencyContactRelationship} onChange={(v) => setField("emergencyContactRelationship", v)} />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : mode === "create" ? "Create Employee" : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  required,
  errors,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  errors?: string[];
}) {
  return (
    <div>
      <Label>
        {label}
        {required && <span className="text-red-500"> *</span>}
      </Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} />
      {errors?.map((message) => (
        <p key={message} className="mt-1 text-xs text-red-600">
          {message}
        </p>
      ))}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  clearable,
  errors,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  clearable?: boolean;
  errors?: string[];
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Select value={value || undefined} onValueChange={(v) => onChange(v === "__none__" ? "" : v)}>
        <SelectTrigger>
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {clearable && <SelectItem value="__none__">None</SelectItem>}
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {errors?.map((message) => (
        <p key={message} className="mt-1 text-xs text-red-600">
          {message}
        </p>
      ))}
    </div>
  );
}
