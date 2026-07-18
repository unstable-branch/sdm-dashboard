import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { readdirSync, statSync } from "fs";
import { stat, readFile } from "fs/promises";
import { join, isAbsolute, normalize, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const PROJECT_ROOT = resolve(__dirname, "../..");

export function getDirSize(dirPath: string): number {
  let total = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirSize(fullPath);
      } else if (entry.isFile()) {
        total += statSync(fullPath).size;
      }
    }
  } catch {
    // Directory doesn't exist or can't be read — return 0
  }
  return total;
}

function envOrDevDefault(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${name} must be configured in production`);
  }
  return devDefault;
}

const GARAGE_ENDPOINT = envOrDevDefault("GARAGE_ENDPOINT", "localhost:3900").replace(/^https?:\/\//, "");
const GARAGE_ACCESS_KEY = process.env.GARAGE_ACCESS_KEY || envOrDevDefault("GARAGE_ACCESS_KEY_ID", "sdm");
const GARAGE_SECRET_KEY = envOrDevDefault("GARAGE_SECRET_KEY", "sdm_garage_secret");
const GARAGE_BUCKET_RASTERS = envOrDevDefault("GARAGE_BUCKET_RASTERS", "sdm-artifacts");
const GARAGE_BUCKET_EXPORTS = envOrDevDefault("GARAGE_BUCKET_EXPORTS", "sdm-artifacts");
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
    accessKey: GARAGE_ACCESS_KEY,
    secretKey: GARAGE_SECRET_KEY,
  };
}

export function getBucketNames(): { rasters: string; exports: string } {
  return {
    rasters: GARAGE_BUCKET_RASTERS,
    exports: GARAGE_BUCKET_EXPORTS,
  };
}

let cachedS3Client: S3Client | null = null;

function createS3Client(): S3Client {
  if (cachedS3Client) return cachedS3Client;
  const config = getGarageConfig();
  cachedS3Client = new S3Client({
    endpoint: `${config.useSSL ? "https" : "http"}://${config.endPoint}:${config.port}`,
    region: "garage",
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
  });
  return cachedS3Client;
}

export async function ensureBuckets(): Promise<void> {
  const s3 = createS3Client();
  const { rasters, exports } = getBucketNames();
  const buckets = [rasters, exports];

  for (const bucket of buckets) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
      console.log(`[Garage] Bucket exists: ${bucket}`);
    } catch {
      try {
        await s3.send(new CreateBucketCommand({ Bucket: bucket }));
        console.log(`[Garage] Created bucket: ${bucket}`);
      } catch (err: unknown) {
        if (err instanceof Error && "name" in err && (err as { name: string }).name === "BucketAlreadyOwnedByYou") {
          console.log(`[Garage] Bucket already exists: ${bucket}`);
        } else {
          throw err;
        }
      }
    }
  }
}

export async function uploadFile(
  bucket: string,
  objectName: string,
  data: Buffer | NodeJS.ReadableStream,
  contentType: string
): Promise<string> {
  const s3 = createS3Client();
  const body = Buffer.isBuffer(data) ? data : await streamToBuffer(data);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectName,
      Body: body,
      ContentType: contentType,
    })
  );

  const protocol = USE_SSL ? "https" : "http";
  return `${protocol}://${GARAGE_ENDPOINT}/${bucket}/${objectName}`;
}

export async function downloadFile(
  bucket: string,
  objectName: string
): Promise<Buffer> {
  const s3 = createS3Client();
  const response = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: objectName })
  );
  if (!response.Body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of response.Body as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function deleteFile(
  bucket: string,
  objectName: string
): Promise<void> {
  const s3 = createS3Client();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectName }));
}

export async function listFiles(
  bucket: string,
  prefix?: string
): Promise<string[]> {
  const s3 = createS3Client();
  const response = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix })
  );
  return (response.Contents ?? []).map((obj) => obj.Key ?? "").filter(Boolean);
}

export async function syncOutputsToS3(
  jobDir: string,
  runId: string,
  outputFiles: Record<string, string> | null
): Promise<Record<string, string>> {
  const bucket = GARAGE_BUCKET_RASTERS;
  const s3Urls: Record<string, string> = {};

  if (!outputFiles) return s3Urls;

  const fileExtensionContentType: Record<string, string> = {
    ".tif": "image/tiff",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".zip": "application/zip",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".pdf": "application/pdf",
    ".html": "text/html",
    ".rds": "application/octet-stream",
  };

  for (const [key, containerPath] of Object.entries(outputFiles)) {
    if (!containerPath || typeof containerPath !== "string") continue;

    const localPath = containerPath.startsWith("/app/")
      ? join(PROJECT_ROOT, containerPath.slice(5))
      : containerPath.startsWith("/")
      ? containerPath
      : join(jobDir, containerPath);

    let resolvedPath: string;
    try {
      resolvedPath = isAbsolute(localPath) ? localPath : normalize(localPath);
      await stat(resolvedPath);
    } catch {
      continue;
    }

    const objectName = `runs/${runId}/${key}`;
    const ext = fileExtensionContentType[Object.keys(fileExtensionContentType).find((e) => resolvedPath.endsWith(e)) ?? ""] ?? "application/octet-stream";

    try {
      const data = await readFile(resolvedPath);
      // Retry upload up to 3 times with exponential backoff
      let lastErr: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await uploadFile(bucket, objectName, data, ext);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          if (attempt < 3) {
            const delay = Math.min(5000 * Math.pow(3, attempt - 1), 45000) + Math.random() * 1000;
            console.warn(`[S3] Upload ${key} attempt ${attempt} failed, retrying in ${delay}ms:`, e instanceof Error ? e.message : e);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }
      if (lastErr) throw lastErr;
      s3Urls[key] = objectName;
    } catch (err) {
      console.warn(`[S3] Failed to upload ${key} for run ${runId} after 3 attempts:`, err instanceof Error ? err.message : err);
    }
  }

  return s3Urls;
}

export async function getFileUrl(
  bucket: string,
  objectName: string,
  _expirySeconds = 3600
): Promise<string> {
  const protocol = USE_SSL ? "https" : "http";
  return `${protocol}://${GARAGE_ENDPOINT}/${bucket}/${objectName}`;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function writeAtomic(path: string, data: Buffer | string): Promise<void> {
  const { writeFile, rename } = await import("fs/promises");
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

export function writeAtomicSync(path: string, data: Buffer | string): void {
  const { writeFileSync, renameSync } = require("fs");
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}
