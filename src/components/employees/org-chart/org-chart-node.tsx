"use client";

import { useState } from "react";
import Link from "next/link";
import type { OrgChartNode } from "@/domains/employee/model";

/**
 * Lazy per-subtree loading: a node's direct reports are only fetched when the user expands it
 * (one request per expand, cached in local state after that), never the whole company tree up
 * front — keeps the chart usable for large organizations.
 */
export function OrgChartNodeItem({ node, depth = 0 }: { node: OrgChartNode; depth?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<OrgChartNode[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (!expanded && children === null) {
      setLoading(true);
      const response = await fetch(`/api/employees/org-chart?managerId=${node.id}`);
      const body = await response.json();
      setChildren(body.data as OrgChartNode[]);
      setLoading(false);
    }
    setExpanded((prev) => !prev);
  }

  return (
    <div style={{ marginLeft: depth * 24 }}>
      <div className="flex items-center gap-2 rounded-md py-1.5 pr-2 hover:bg-slate-50">
        {node.directReportCount > 0 ? (
          <button
            type="button"
            onClick={toggle}
            aria-label={expanded ? "Collapse" : "Expand"}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600"
          >
            {loading ? "⋯" : expanded ? "−" : "+"}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}

        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-medium text-slate-600">
          {node.firstName[0]}
          {node.lastName[0]}
        </div>

        <Link href={`/employees/${node.id}`} className="text-sm font-medium text-blue-700 hover:underline">
          {node.firstName} {node.lastName}
        </Link>
        <span className="text-xs text-slate-400">
          {[node.designationName, node.departmentName].filter(Boolean).join(" · ")}
        </span>
        {node.directReportCount > 0 && (
          <span className="text-xs text-slate-400">
            ({node.directReportCount} report{node.directReportCount === 1 ? "" : "s"})
          </span>
        )}
      </div>

      {expanded && children && (
        <div className="border-l border-slate-100">
          {children.map((child) => (
            <OrgChartNodeItem key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
