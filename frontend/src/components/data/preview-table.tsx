"use client";

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";

interface PreviewTableProps {
  data: Array<Record<string, unknown>>;
  title?: string;
}

export function PreviewTable({ data, title }: PreviewTableProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
        No records to display
      </div>
    );
  }

  const columns = Object.keys(data[0]).map((key) => ({
    accessorKey: key,
    header: key,
    cell: (info: { getValue: () => unknown }) => {
      const value = info.getValue();
      if (value === null || value === undefined) return <span className="text-sdm-muted italic">null</span>;
      return String(value);
    },
  }));

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
        <table className="w-full text-sm">
          <thead>
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
              <tr key={row.id} className="border-b border-sdm-border/50 hover:bg-sdm-surface-soft/50 transition-colors">
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
