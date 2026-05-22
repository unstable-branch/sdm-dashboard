"use client";

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
} from "@tanstack/react-table";
import { useMemo } from "react";

interface PreviewTableProps {
  data: Array<Record<string, unknown>>;
  title?: string;
}

const CORE_KEYS = new Set(["longitude", "latitude", "source", "countryCode", "year", "presence"]);

function formatNum(v: unknown) {
  const n = Number(v);
  return isNaN(n) ? null : n.toFixed(4);
}

export function PreviewTable({ data, title }: PreviewTableProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
        No records to display
      </div>
    );
  }

  const extraKeys = useMemo(() => {
    return Object.keys(data[0]).filter(k => !CORE_KEYS.has(k) && !k.startsWith("cc_") && k !== "flagged");
  }, [data]);

  const columns = [
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
        if (v === null || v === undefined) return <span className="text-sdm-muted italic text-xs">—</span>;
        return <span className="truncate block max-w-[160px] text-xs" title={String(v)}>{String(v)}</span>;
      },
    },
    ...extraKeys.map(key => ({
      accessorKey: key,
      header: key,
      size: 100,
      cell: (info: { getValue: () => unknown }) => {
        const value = info.getValue();
        if (value === null || value === undefined) return <span className="text-sdm-muted italic text-xs">null</span>;
        return <span className="truncate block max-w-[100px] text-xs" title={String(value)}>{String(value)}</span>;
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
        <div className="px-4 py-3 border-b border-sdm-border">
          <h3 className="text-sm font-semibold text-sdm-heading">{title}</h3>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 400 }}>
          <thead>
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
              <tr key={row.id} className="border-b border-sdm-border/50 hover:bg-sdm-surface-soft/50 transition-colors">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2 text-sdm-text" style={{ width: cell.column.getSize() }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
