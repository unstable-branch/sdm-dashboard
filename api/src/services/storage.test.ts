import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, statSync } from "fs";
import { stat, readFile } from "fs/promises";

const mockS3Send = vi.hoisted(() => vi.fn());

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.GARAGE_ENDPOINT = "s3.example.com:3900";
  process.env.GARAGE_ACCESS_KEY = "test-key";
  process.env.GARAGE_SECRET_KEY = "test-secret";
  process.env.GARAGE_BUCKET_RASTERS = "test-rasters";
  process.env.GARAGE_BUCKET_EXPORTS = "test-rasters";
  process.env.GARAGE_USE_SSL = "false";
  process.env.JWT_SECRET = "test-jwt";
});

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(function () { return { send: mockS3Send }; }),
  CreateBucketCommand: vi.fn(),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  HeadBucketCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
  ListObjectsV2Command: vi.fn(),
}));

vi.mock("fs", () => ({
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
}));

import {
  getDirSize,
  getGarageConfig,
  getBucketNames,
  ensureBuckets,
  uploadFile,
  downloadFile,
  deleteFile,
  listFiles,
  syncOutputsToS3,
  getFileUrl,
} from "./storage.js";

describe("getDirSize", () => {
  beforeEach(() => {
    vi.mocked(readdirSync).mockReset();
    vi.mocked(statSync).mockReset();
  });

  it("returns 0 when directory cannot be read", () => {
    vi.mocked(readdirSync).mockImplementation(() => { throw new Error("ENOENT"); });
    expect(getDirSize("/nonexistent")).toBe(0);
  });

  it("sums file sizes in a directory", () => {
    const entryA = { name: "a.tif", isDirectory: () => false, isFile: () => true } as any;
    const entryB = { name: "b.csv", isDirectory: () => false, isFile: () => true } as any;
    vi.mocked(readdirSync).mockReturnValue([entryA, entryB]);
    vi.mocked(statSync).mockImplementation((p: any) => {
      if ((p as string).endsWith("a.tif")) return { size: 100 } as any;
      if ((p as string).endsWith("b.csv")) return { size: 200 } as any;
      return { size: 0 } as any;
    });
    expect(getDirSize("/dir")).toBe(300);
  });

  it("recurses into subdirectories", () => {
    const subEntry = { name: "c.png", isDirectory: () => false, isFile: () => true } as any;
    const dirEntry = { name: "sub", isDirectory: () => true, isFile: () => false } as any;
    const topEntry = { name: "d.txt", isDirectory: () => false, isFile: () => true } as any;

    let callCount = 0;
    vi.mocked(readdirSync).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return [dirEntry, topEntry];
      return [subEntry];
    });
    vi.mocked(statSync).mockImplementation((p: any) => {
      if ((p as string).endsWith("c.png")) return { size: 300 } as any;
      if ((p as string).endsWith("d.txt")) return { size: 50 } as any;
      return { size: 0 } as any;
    });
    expect(getDirSize("/dir")).toBe(350);
  });
});

describe("getGarageConfig", () => {
  it("returns parsed garage configuration", () => {
    const config = getGarageConfig();
    expect(config).toEqual({
      endPoint: "s3.example.com",
      port: 3900,
      useSSL: false,
      accessKey: "test-key",
      secretKey: "test-secret",
    });
  });
});

describe("getBucketNames", () => {
  it("returns bucket names from env", () => {
    expect(getBucketNames()).toEqual({ rasters: "test-rasters", exports: "test-rasters" });
  });
});

describe("ensureBuckets", () => {
  beforeEach(() => {
    mockS3Send.mockReset();
  });

  it("skips buckets that already exist", async () => {
    mockS3Send.mockResolvedValue(undefined);
    await ensureBuckets();
    expect(mockS3Send).toHaveBeenCalledTimes(2);
  });

  it("creates buckets when they do not exist", async () => {
    mockS3Send
      .mockRejectedValueOnce(new Error("NoSuchBucket"))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("NoSuchBucket"))
      .mockResolvedValueOnce(undefined);
    await ensureBuckets();
    expect(mockS3Send).toHaveBeenCalledTimes(4);
  });

  it("handles BucketAlreadyOwnedByYou error gracefully", async () => {
    const alreadyOwned = new Error("Bucket already owned");
    (alreadyOwned as any).name = "BucketAlreadyOwnedByYou";
    mockS3Send
      .mockRejectedValueOnce(new Error("NoSuchBucket"))
      .mockRejectedValueOnce(alreadyOwned)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    await expect(ensureBuckets()).resolves.toBeUndefined();
  });

  it("rethrows unexpected errors", async () => {
    mockS3Send
      .mockRejectedValueOnce(new Error("NoSuchBucket"))
      .mockRejectedValueOnce(new Error("AccessDenied"));
    await expect(ensureBuckets()).rejects.toThrow("AccessDenied");
  });
});

describe("uploadFile", () => {
  beforeEach(() => {
    mockS3Send.mockReset();
    mockS3Send.mockResolvedValue(undefined);
  });

  it("uploads a buffer and returns URL", async () => {
    const url = await uploadFile("test-rasters", "runs/abc/model.tif", Buffer.from("data"), "image/tiff");
    expect(mockS3Send).toHaveBeenCalledOnce();
    expect(url).toBe("http://s3.example.com:3900/test-rasters/runs/abc/model.tif");
  });

  it("uploads a stream by converting to buffer", async () => {
    const { Readable } = await import("stream");
    const stream = new Readable();
    stream.push("stream-data");
    stream.push(null);
    const url = await uploadFile("bucket", "obj", stream as any, "text/plain");
    expect(mockS3Send).toHaveBeenCalledOnce();
    expect(url).toContain("/bucket/obj");
  });
});

describe("downloadFile", () => {
  beforeEach(() => {
    mockS3Send.mockReset();
  });

  it("downloads file and returns buffer", async () => {
    mockS3Send.mockResolvedValue({
      Body: (async function* () { yield Buffer.from("hello"); })(),
    });
    const result = await downloadFile("bucket", "key");
    expect(result.toString()).toBe("hello");
  });

  it("returns empty buffer when no body", async () => {
    mockS3Send.mockResolvedValue({ Body: null });
    const result = await downloadFile("bucket", "key");
    expect(result.length).toBe(0);
  });
});

describe("deleteFile", () => {
  beforeEach(() => {
    mockS3Send.mockReset();
    mockS3Send.mockResolvedValue(undefined);
  });

  it("sends DeleteObjectCommand", async () => {
    await deleteFile("bucket", "key");
    expect(mockS3Send).toHaveBeenCalledOnce();
  });
});

describe("listFiles", () => {
  beforeEach(() => {
    mockS3Send.mockReset();
  });

  it("returns list of object keys", async () => {
    mockS3Send.mockResolvedValue({
      Contents: [{ Key: "runs/abc/model.tif" }, { Key: "runs/abc/report.md" }],
    });
    const files = await listFiles("bucket", "runs/abc/");
    expect(files).toEqual(["runs/abc/model.tif", "runs/abc/report.md"]);
  });

  it("returns empty array when no objects", async () => {
    mockS3Send.mockResolvedValue({ Contents: undefined });
    const files = await listFiles("bucket");
    expect(files).toEqual([]);
  });

  it("filters out empty keys", async () => {
    mockS3Send.mockResolvedValue({
      Contents: [{ Key: "valid" }, { Key: "" }, { Key: null }],
    });
    const files = await listFiles("bucket");
    expect(files).toEqual(["valid"]);
  });
});

describe("syncOutputsToS3", () => {
  beforeEach(() => {
    mockS3Send.mockReset();
    mockS3Send.mockResolvedValue(undefined);
    vi.mocked(stat).mockReset();
    vi.mocked(readFile).mockReset();
  });

  it("returns empty object when outputFiles is null", async () => {
    const result = await syncOutputsToS3("/jobs/run-1", "run-1", null);
    expect(result).toEqual({});
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it("skips files that do not exist locally", async () => {
    vi.mocked(stat).mockRejectedValue(new Error("ENOENT"));
    const result = await syncOutputsToS3("/jobs/run-1", "run-1", {
      model: "outputs/model.tif",
    });
    expect(result).toEqual({});
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it("uploads existing files with correct content type", async () => {
    vi.mocked(stat).mockResolvedValue(undefined as any);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("data"));
    const result = await syncOutputsToS3("/jobs/run-1", "run-1", {
      model: "/app/outputs/model.tif",
      report: "/app/outputs/report.md",
    });
    expect(result).toEqual({ model: "runs/run-1/model", report: "runs/run-1/report" });
    expect(mockS3Send).toHaveBeenCalledTimes(2);
  });

  it("continues after individual upload failure", async () => {
    vi.useFakeTimers();
    vi.mocked(stat).mockResolvedValue(undefined as any);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("data"));
    mockS3Send
      .mockRejectedValueOnce(new Error("Upload failed"))
      .mockRejectedValueOnce(new Error("Upload failed"))
      .mockRejectedValueOnce(new Error("Upload failed"))
      .mockResolvedValueOnce(undefined);

    const sync = syncOutputsToS3("/jobs/run-1", "run-1", {
      bad: "/app/outputs/bad.tif",
      good: "/app/outputs/good.csv",
    });
    await vi.runAllTimersAsync();

    await expect(sync).resolves.toEqual({ good: "runs/run-1/good" });
    expect(mockS3Send).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it("resolves relative paths relative to jobDir", async () => {
    vi.mocked(stat).mockResolvedValue(undefined as any);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("data"));
    const result = await syncOutputsToS3("/jobs/run-1", "run-1", {
      output: "results/output.tif",
    });
    expect(result).toEqual({ output: "runs/run-1/output" });
  });

  it("resolves absolute paths as-is", async () => {
    vi.mocked(stat).mockResolvedValue(undefined as any);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("data"));
    const result = await syncOutputsToS3("/jobs/run-1", "run-1", {
      output: "/absolute/output.tif",
    });
    expect(result).toEqual({ output: "runs/run-1/output" });
  });

  it("skips entries with falsy or non-string paths", async () => {
    vi.mocked(stat).mockResolvedValue(undefined as any);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("data"));
    const result = await syncOutputsToS3("/jobs/run-1", "run-1", {
      valid: "/app/outputs/valid.tif",
      empty: "",
      nulled: null as any,
    });
    expect(result).toEqual({ valid: "runs/run-1/valid" });
    expect(mockS3Send).toHaveBeenCalledTimes(1);
  });
});

describe("getFileUrl", () => {
  it("returns constructed URL without SSL", async () => {
    const url = await getFileUrl("test-rasters", "runs/abc/model.tif");
    expect(url).toBe("http://s3.example.com:3900/test-rasters/runs/abc/model.tif");
  });
});
