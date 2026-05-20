const GARAGE_ENDPOINT = process.env.GARAGE_ENDPOINT || "localhost:3900";
const GARAGE_ACCESS_KEY_ID = process.env.GARAGE_ACCESS_KEY_ID || "sdm";
const GARAGE_SECRET_KEY = process.env.GARAGE_SECRET_KEY || "sdm_garage_secret";
const GARAGE_BUCKET_RASTERS = process.env.GARAGE_BUCKET_RASTERS || "sdm-rasters";
const GARAGE_BUCKET_EXPORTS = process.env.GARAGE_BUCKET_EXPORTS || "sdm-exports";
const USE_SSL = process.env.GARAGE_USE_SSL === "true";

export interface GarageConfig {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
}

export function getGarageConfig(): GarageConfig {
  const [host, portStr] = GARAGE_ENDPOINT.split(":");
  return {
    endPoint: host,
    port: parseInt(portStr || "3900", 10),
    useSSL: USE_SSL,
    accessKey: GARAGE_ACCESS_KEY_ID,
    secretKey: GARAGE_SECRET_KEY,
  };
}

export function getBucketNames(): { rasters: string; exports: string } {
  return {
    rasters: GARAGE_BUCKET_RASTERS,
    exports: GARAGE_BUCKET_EXPORTS,
  };
}

export async function ensureBuckets(): Promise<void> {
  const { rasters, exports } = getBucketNames();
  console.log(`[Garage] Buckets configured: ${rasters}, ${exports}`);
  console.log(`[Garage] Endpoint: ${GARAGE_ENDPOINT}`);
}

export async function uploadFile(
  bucket: string,
  objectName: string,
  data: Buffer | NodeJS.ReadableStream,
  contentType: string
): Promise<string> {
  const size = Buffer.isBuffer(data) ? data.length : 0;
  console.log(`[Garage] Upload: ${bucket}/${objectName} (${size} bytes, ${contentType})`);
  return `${bucket}/${objectName}`;
}

export async function downloadFile(
  bucket: string,
  objectName: string
): Promise<Buffer> {
  console.log(`[Garage] Download: ${bucket}/${objectName}`);
  return Buffer.alloc(0);
}

export async function getFileUrl(
  bucket: string,
  objectName: string,
  expirySeconds = 3600
): Promise<string> {
  const protocol = USE_SSL ? "https" : "http";
  return `${protocol}://${GARAGE_ENDPOINT}/${bucket}/${objectName}`;
}
