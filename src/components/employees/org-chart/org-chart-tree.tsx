"use client";

import { useEffect, useState } from "react";
import type { OrgChartNode } from "@/domains/employee/model";
import { OrgChartNodeItem } from "./org-chart-node";

export function OrgChartTree() {
  const [roots, setRoots] = useState<OrgChartNode[] | null>(null);

  useEffect(() => {
    fetch("/api/employees/org-chart")
      .then((r) => r.json())
      .then((body) => setRoots(body.data as OrgChartNode[]));
  }, []);

  if (roots === null) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }
  if (roots.length === 0) {
    return <p className="text-sm text-slate-500">No employees without a manager found to anchor the chart.</p>;
  }

  return (
    <div>
      {roots.map((node) => (
        <OrgChartNodeItem key={node.id} node={node} />
      ))}
    </div>
  );
}
