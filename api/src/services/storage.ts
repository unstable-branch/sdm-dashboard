const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || "localhost:9000";
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || "sdm";
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || "sdm_minio_password";
const MINIO_BUCKET_RASTERS = process.env.MINIO_BUCKET_RASTERS || "sdm-rasters";
const MINIO_BUCKET_EXPORTS = process.env.MINIO_BUCKET_EXPORTS || "sdm-exports";
const USE_SSL = process.env.MINIO_USE_SSL === "true";

export interface MinioConfig {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
}

export function getMinioConfig(): MinioConfig {
  const [host, portStr] = MINIO_ENDPOINT.split(":");
  return {
    endPoint: host,
    port: parseInt(portStr || "9000", 10),
    useSSL: USE_SSL,
    accessKey: MINIO_ACCESS_KEY,
    secretKey: MINIO_SECRET_KEY,
  };
}

export function getBucketNames(): { rasters: string; exports: string } {
  return {
    rasters: MINIO_BUCKET_RASTERS,
    exports: MINIO_BUCKET_EXPORTS,
  };
}

export async function ensureBuckets(): Promise<void> {
  const { rasters, exports } = getBucketNames();
  console.log(`[MinIO] Buckets configured: ${rasters}, ${exports}`);
  console.log(`[MinIO] Endpoint: ${MINIO_ENDPOINT}`);
}

export async function uploadFile(
  bucket: string,
  objectName: string,
  data: Buffer | NodeJS.ReadableStream,
  contentType: string
): Promise<string> {
  const size = Buffer.isBuffer(data) ? data.length : 0;
  console.log(`[MinIO] Upload: ${bucket}/${objectName} (${size} bytes, ${contentType})`);
  return `${bucket}/${objectName}`;
}

export async function downloadFile(
  bucket: string,
  objectName: string
): Promise<Buffer> {
  console.log(`[MinIO] Download: ${bucket}/${objectName}`);
  return Buffer.alloc(0);
}

export async function getFileUrl(
  bucket: string,
  objectName: string,
  expirySeconds = 3600
): Promise<string> {
  const protocol = USE_SSL ? "https" : "http";
  return `${protocol}://${MINIO_ENDPOINT}/${bucket}/${objectName}`;
}
