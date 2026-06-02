import { useState, useEffect } from "react";
import { fromArrayBuffer } from "geotiff";

export interface RasterData {
  data: Float32Array;
  width: number;
  height: number;
  bbox: [number, number, number, number];
}

export function useRasterData(url: string | null) {
  const [result, setResult] = useState<{
    data: RasterData | null;
    loading: boolean;
    error: string | null;
  }>({ data: null, loading: true, error: null });

  useEffect(() => {
    if (!url) {
      setResult({ data: null, loading: false, error: null });
      return;
    }

    const abort = new AbortController();
    setResult({ data: null, loading: true, error: null });

    (async () => {
      try {
        const response = await fetch(url, { signal: abort.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        const tiff = await fromArrayBuffer(buffer);
        const image = await tiff.getImage();
        const bboxRaw = image.getBoundingBox();
        const width = image.getWidth();
        const height = image.getHeight();

        if (width * height > 5_000_000) {
          throw new Error(`Raster too large for hover data (${(width * height / 1_000_000).toFixed(0)}M pixels). Map tiles still work.`);
        }

        const rasters = await image.readRasters({ samples: [0] });
        const data = rasters[0] as Float32Array;

        setResult({
          data: { data, width, height, bbox: [bboxRaw[0], bboxRaw[2], bboxRaw[1], bboxRaw[3]] as [number, number, number, number] },
          loading: false,
          error: null,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setResult({
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load raster",
        });
      }
    })();

    return () => { abort.abort(); };
  }, [url]);

  return result;
}
