"use client";

import { useState } from "react";
import { FileUpload } from "@/components/data/file-upload";
import { GbifSearch } from "@/components/data/gbif-search";
import { PreviewTable } from "@/components/data/preview-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Globe, FileArchive } from "lucide-react";

export default function DataPage() {
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<Record<string, unknown> | null>(null);

  const [gbifLoading, setGbifLoading] = useState(false);
  const [gbifError, setGbifError] = useState<string | null>(null);
  const [gbifResult, setGbifResult] = useState<Record<string, unknown> | null>(null);

  const handleUpload = async (file: File) => {
    setUploadLoading(true);
    setUploadError(null);
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/v1/data/occurrences/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }

      const result = await res.json();
      setUploadResult(result);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadLoading(false);
    }
  };

  const handleGbifSearch = async (taxon: string, country: string, maxRecords: number) => {
    setGbifLoading(true);
    setGbifError(null);
    setGbifResult(null);

    try {
      const res = await fetch("/api/v1/data/occurrences/gbif/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxon, country, max_records: maxRecords }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "GBIF search failed");
      }

      const result = await res.json();
      setGbifResult(result);
    } catch (err) {
      setGbifError(err instanceof Error ? err.message : "GBIF search failed");
    } finally {
      setGbifLoading(false);
    }
  };

  const preview = uploadResult?.preview as Array<Record<string, unknown>> | undefined;
  const gbifPreview = gbifResult?.preview as Array<Record<string, unknown>> | undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sdm-heading">Occurrence Data</h1>
        <p className="text-sdm-muted mt-1">
          Upload occurrence records from a file, fetch from GBIF, or parse a Darwin Core Archive.
        </p>
      </div>

      <Tabs defaultValue="upload" className="space-y-4">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="upload" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Upload
          </TabsTrigger>
          <TabsTrigger value="gbif" className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            GBIF
          </TabsTrigger>
          <TabsTrigger value="dwca" className="flex items-center gap-2">
            <FileArchive className="h-4 w-4" />
            DwC-A
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="space-y-4">
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
            <h2 className="text-lg font-semibold text-sdm-heading mb-4">Upload occurrence file</h2>
            <p className="text-sm text-sdm-muted mb-4">
              Upload a CSV, TSV, or ZIP file containing occurrence records.
              The file must have longitude and latitude columns (aliases like lon/lat/x/y are detected automatically).
            </p>
            <FileUpload
              onUpload={handleUpload}
              loading={uploadLoading}
              error={uploadError}
            />
          </div>

          {preview && preview.length > 0 && (
            <PreviewTable data={preview} title="Preview (first 5 records)" />
          )}
        </TabsContent>

        <TabsContent value="gbif" className="space-y-4">
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
            <h2 className="text-lg font-semibold text-sdm-heading mb-4">Fetch from GBIF</h2>
            <p className="text-sm text-sdm-muted mb-4">
              Search the Global Biodiversity Information Facility for occurrence records.
              Results are fetched directly and can be cleaned before use.
            </p>
            <GbifSearch
              onSearch={handleGbifSearch}
              loading={gbifLoading}
              error={gbifError}
              result={gbifResult}
            />
          </div>

          {gbifPreview && gbifPreview.length > 0 && (
            <PreviewTable data={gbifPreview} title="GBIF Preview (first 5 records)" />
          )}
        </TabsContent>

        <TabsContent value="dwca" className="space-y-4">
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
            <h2 className="text-lg font-semibold text-sdm-heading mb-4">Parse Darwin Core Archive</h2>
            <p className="text-sm text-sdm-muted mb-4">
              Upload a GBIF bulk download ZIP file. The archive is parsed automatically,
              extracting occurrence data and dataset DOI for provenance.
            </p>
            <FileUpload
              onUpload={handleUpload}
              loading={uploadLoading}
              error={uploadError}
            />
          </div>

          {preview && preview.length > 0 && (
            <PreviewTable data={preview} title="DwC-A Preview (first 5 records)" />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
