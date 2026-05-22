"use client";

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
} from "@tanstack/react-table";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";

interface CleaningTableProps {
  data: Array<Record<string, unknown>>;
  onFlagToggle?: (index: number, flagged: boolean) => void;
  title?: string;
}

const CORE_KEYS = new Set(["longitude", "latitude", "source", "countryCode", "year", "presence", "cc_flag", "flagged"]);

const CC_LABELS: Record<string, string> = {
  cc_test_sea: "sea",
  cc_test_capitals: "cap",
  cc_test_centroids: "ctrd",
  cc_test_institutions: "inst",
  cc_test_urban: "urban",
  cc_test_zero: "zero",
  cc_test_equal: "eq",
  cc_test_gbif: "gbif",
  cc_test_country: "ctry",
};

function formatNum(v: unknown) {
  const n = Number(v);
  return isNaN(n) ? null : n.toFixed(4);
}

export function CleaningTable({ data, onFlagToggle, title }: CleaningTableProps) {
  const [flaggedRows, setFlaggedRows] = useState<Set<number>>(new Set());

  const hasCcFlags = useMemo(() => {
    if (data.length === 0) return false;
    return Object.keys(data[0]).some(k => k.startsWith("cc_test_"));
  }, [data]);

  const extraKeys = useMemo(() => {
    if (data.length === 0) return [];
    return Object.keys(data[0]).filter(k => !CORE_KEYS.has(k) && !k.startsWith("cc_test_"));
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
        No records to display
      </div>
    );
  }

  const columns = [
    {
      id: "flag",
      header: "",
      size: 40,
      cell: (info: { row: { index: number } }) => (
        <button
          type="button"
          onClick={() => {
            const idx = info.row.index;
            const isFlagged = flaggedRows.has(idx);
            const next = new Set(flaggedRows);
            if (isFlagged) next.delete(idx);
            else next.add(idx);
            setFlaggedRows(next);
            onFlagToggle?.(idx, !isFlagged);
          }}
          className={cn(
            "h-5 w-5 rounded border-2 transition-colors flex-shrink-0",
            flaggedRows.has(info.row.index)
              ? "bg-sdm-danger border-sdm-danger"
              : "border-sdm-border hover:border-sdm-accent"
          )}
          aria-label={flaggedRows.has(info.row.index) ? "Unflag record" : "Flag record"}
        />
      ),
    },
    {
      accessorKey: "longitude",
      header: "Longitude",
      size: 110,
      cell: (info: { getValue: () => unknown }) => {
        const v = formatNum(info.getValue());
        return v !== null ? <span className="font-mono text-xs">{v}</span> : null;
      },
    },
    {
      accessorKey: "latitude",
      header: "Latitude",
      size: 110,
      cell: (info: { getValue: () => unknown }) => {
        const v = formatNum(info.getValue());
        return v !== null ? <span className="font-mono text-xs">{v}</span> : null;
      },
    },
    {
      accessorKey: "source",
      header: "Source",
      size: 160,
      cell: (info: { getValue: () => unknown }) => {
        const v = info.getValue();
        if (v === null || v === undefined) return <span className="text-sdm-muted italic">—</span>;
        return <span className="truncate block max-w-[160px]" title={String(v)}>{String(v)}</span>;
      },
    },
    {
      accessorKey: "countryCode",
      header: "Country",
      size: 80,
      cell: (info: { getValue: () => unknown }) => {
        const v = info.getValue();
        if (v === null || v === undefined || v === "") return <span className="text-sdm-muted italic">—</span>;
        return <span className="text-xs">{String(v)}</span>;
      },
    },
    {
      accessorKey: "year",
      header: "Year",
      size: 70,
      cell: (info: { getValue: () => unknown }) => {
        const v = info.getValue();
        if (v === null || v === undefined) return <span className="text-sdm-muted italic">—</span>;
        return <span className="text-xs">{String(v)}</span>;
      },
    },
    ...(hasCcFlags
      ? [{
          id: "flags",
          header: "Flags",
          size: 140,
          cell: (info: { row: { original: Record<string, unknown> } }) => {
            const row = info.row.original;
            const active = Object.keys(CC_LABELS)
              .filter(k => row[k] && String(row[k]) !== "" && String(row[k]) !== "FALSE")
              .map(k => CC_LABELS[k]);
            if (active.length === 0) return <span className="text-sdm-muted italic text-xs">—</span>;
            return (
              <div className="flex flex-wrap gap-1">
                {active.map(label => (
                  <span
                    key={label}
                    className="inline-flex items-center rounded bg-sdm-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-sdm-warning uppercase leading-tight"
                    title={`Flagged by: ${label}`}
                  >
                    {label}
                  </span>
                ))}
              </div>
            );
          },
        } as const]
      : []),
    {
      accessorKey: "flagged",
      header: "Flagged",
      size: 70,
      cell: (info: { getValue: () => unknown }) => {
        const v = info.getValue();
        if (v === true || v === "TRUE" || v === "true") {
          return <span className="text-xs font-medium text-sdm-danger">Yes</span>;
        }
        if (v === false || v === "FALSE" || v === "false") {
          return <span className="text-xs text-sdm-muted">No</span>;
        }
        return null;
      },
    },
    ...extraKeys.map(key => ({
      accessorKey: key,
      header: key,
      size: 120,
      cell: (info: { getValue: () => unknown }) => {
        const value = info.getValue();
        if (value === null || value === undefined) return <span className="text-sdm-muted italic text-xs">null</span>;
        return <span className="truncate block max-w-[120px] text-xs" title={String(value)}>{String(value)}</span>;
      },
    })),
  ];

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
      {title && (
        <div className="px-4 py-3 border-b border-sdm-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-sdm-heading">{title}</h3>
          {flaggedRows.size > 0 && (
            <span className="text-xs font-medium text-sdm-danger bg-sdm-danger/10 px-2 py-1 rounded-full">
              {flaggedRows.size} flagged
            </span>
          )}
        </div>
      )}
      <div className="overflow-x-auto max-h-[40vh] overflow-y-auto">
        <table className="w-full text-sm" style={{ minWidth: 600 }}>
          <thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-sdm-border bg-sdm-surface-soft">
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-3 py-2 text-left font-semibold text-sdm-muted whitespace-nowrap text-xs uppercase tracking-wider"
                    style={{ width: header.getSize() }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "border-b border-sdm-border/50 transition-colors",
                  flaggedRows.has(row.index)
                    ? "bg-sdm-danger/5"
                    : "hover:bg-sdm-surface-soft/50"
                )}
              >
                {row.getVisibleCells().map((cell) => {
                  const cellVal = cell.getValue();
                  const isFlagged = cell.column.id === "flagged" && (cellVal === true || cellVal === "TRUE" || cellVal === "true");
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        "px-3 py-2 text-sdm-text",
                        isFlagged ? "text-sdm-danger font-medium" : ""
                      )}
                      style={{ width: cell.column.getSize() }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
