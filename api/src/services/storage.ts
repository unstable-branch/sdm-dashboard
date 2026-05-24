import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";

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
const GARAGE_BUCKET_RASTERS = envOrDevDefault("GARAGE_BUCKET_RASTERS", "sdm-rasters");
const GARAGE_BUCKET_EXPORTS = envOrDevDefault("GARAGE_BUCKET_EXPORTS", "sdm-exports");
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

function createS3Client(): S3Client {
  const config = getGarageConfig();
  return new S3Client({
    endpoint: `http://${config.endPoint}:${config.port}`,
    region: "garage",
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
  });
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
