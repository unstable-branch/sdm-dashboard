"use client";

import { useState, useEffect } from "react";
import { apiGet } from "@/services/api";
import { Loader2, Table2 } from "lucide-react";

interface TableRow { tablename: string; size: string; estimated_rows: number; }
interface ColumnRow { column_name: string; data_type: string; is_nullable: string; column_default: string | null; }
interface TableData { table: string; columns: ColumnRow[]; rows: Record<string, unknown>[]; total: number; page: number; limit: number; }
interface TableStats { table: string; indexes: { indexname: string; indexdef: string }[]; constraints: { conname: string; contype: string }[]; size: string; }

export default function AdminDatabasePage() {
  const [tables, setTables] = useState<TableRow[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [tableStats, setTableStats] = useState<TableStats | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetch() {
      try {
        const t = await apiGet<TableRow[]>("/api/v1/admin/database/tables");
        setTables(t);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load tables");
      } finally {
        setLoading(false);
      }
    }
    fetch();
  }, []);

  useEffect(() => {
    if (!selectedTable) return;
    async function fetch() {
      setDataLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), limit: "50" });
        const [d, s] = await Promise.all([
          apiGet<TableData>(`/api/v1/admin/database/${selectedTable}?${params}`),
          apiGet<TableStats>(`/api/v1/admin/database/${selectedTable}/stats`),
        ]);
        setTableData(d);
        setTableStats(s);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load table");
      } finally {
        setDataLoading(false);
      }
    }
    fetch();
  }, [selectedTable, page]);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-sdm-accent" /></div>;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold text-sdm-heading">Database Browser</h1>
      {error && <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">{error}</div>}

      <div className="flex gap-4">
        <div className="w-64 shrink-0 rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-2">
          <h2 className="text-sm font-medium text-sdm-heading">Tables</h2>
          {tables.map((t) => (
            <button key={t.tablename}
              onClick={() => { setSelectedTable(t.tablename); setPage(1); setTableData(null); setTableStats(null); }}
              className={`w-full text-left rounded px-3 py-2 text-xs flex justify-between ${selectedTable === t.tablename ? "bg-sdm-accent/10 text-sdm-accent" : "text-sdm-text hover:bg-sdm-surface-soft"}`}>
              <span>{t.tablename}</span>
              <span className="text-sdm-muted">{t.estimated_rows?.toLocaleString()}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-0 space-y-4">
          {!selectedTable ? (
            <div className="flex items-center justify-center h-64 text-sdm-muted text-sm">Select a table from the sidebar</div>
          ) : dataLoading ? (
            <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-sdm-accent" /></div>
          ) : tableData && tableStats ? (
            <>
              <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Table2 className="h-4 w-4 text-sdm-accent" />
                  <span className="text-sm font-medium text-sdm-heading">{tableData.table}</span>
                  <span className="text-xs text-sdm-muted">({tableData.total.toLocaleString()} rows, {tableStats.size})</span>
                </div>
                <div className="flex gap-2 flex-wrap mb-3">
                  {tableStats.indexes.map((idx) => (
                    <span key={idx.indexname} className="rounded bg-sdm-surface-soft px-2 py-0.5 text-xs text-sdm-muted font-mono">{idx.indexname}</span>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-sdm-border bg-sdm-surface-soft">
                    <tr>
                      {tableData.columns.map((col) => (
                        <th key={col.column_name} className="text-left px-3 py-2 text-xs font-medium text-sdm-muted whitespace-nowrap"
                          title={`${col.data_type}${col.is_nullable === "YES" ? ", nullable" : ""}`}>{col.column_name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.rows.map((row, i) => (
                      <tr key={i} className="border-b border-sdm-border hover:bg-sdm-surface-soft">
                        {tableData.columns.map((col) => (
                          <td key={col.column_name} className="px-3 py-1.5 text-xs text-sdm-text max-w-[200px] truncate">
                            {String(row[col.column_name] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between text-sm text-sdm-muted">
                <span>{tableData.total} rows</span>
                <div className="flex gap-2">
                  <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
                    className="rounded border border-sdm-border px-3 py-1 text-xs hover:bg-sdm-surface-soft disabled:opacity-30">Previous</button>
                  <button onClick={() => setPage(page + 1)} disabled={(page * tableData.limit) >= tableData.total}
                    className="rounded border border-sdm-border px-3 py-1 text-xs hover:bg-sdm-surface-soft disabled:opacity-30">Next</button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}