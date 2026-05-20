"use client";

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
} from "@tanstack/react-table";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface CleaningTableProps {
  data: Array<Record<string, unknown>>;
  onFlagToggle?: (index: number, flagged: boolean) => void;
  title?: string;
}

export function CleaningTable({ data, onFlagToggle, title }: CleaningTableProps) {
  const [flaggedRows, setFlaggedRows] = useState<Set<number>>(new Set());

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
      cell: (info: { row: { index: number } }) => (
        <button
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
            "h-5 w-5 rounded border-2 transition-colors",
            flaggedRows.has(info.row.index)
              ? "bg-sdm-danger border-sdm-danger"
              : "border-sdm-border hover:border-sdm-accent"
          )}
          aria-label={flaggedRows.has(info.row.index) ? "Unflag record" : "Flag record"}
        />
      ),
    },
    ...Object.keys(data[0]).map((key) => ({
      accessorKey: key,
      header: key,
      cell: (info: { getValue: () => unknown }) => {
        const value = info.getValue();
        if (value === null || value === undefined) return <span className="text-sdm-muted italic">null</span>;
        return String(value);
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
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-sdm-border bg-sdm-surface-soft">
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-3 py-2 text-left font-semibold text-sdm-muted whitespace-nowrap"
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
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2 text-sdm-text whitespace-nowrap">
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
