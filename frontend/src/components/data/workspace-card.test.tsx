import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceCard } from "./workspace-card";
import type { WorkspaceFile } from "@/app/(dashboard)/data/types";

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: undefined, isDragging: false }),
}));
vi.mock("@dnd-kit/utilities", () => ({ CSS: { Transform: { toString: () => undefined } } }));
vi.mock("@/services/api", () => ({ apiPost: vi.fn() }));

const item: WorkspaceFile = {
  id: "file-1", fileId: "raw", filePath: "raw", fileName: "sample.csv", fileRows: 10, fileCleaned: false,
  selectedSpecies: ["Species"], rawAssetId: "raw", cleanedAssetId: "clean",
  cleanValidRecords: null, cleanLoading: false, cleanError: null,
};

const callbacks = {
  onUpdate: vi.fn(), onRemove: vi.fn(), onClean: vi.fn(),
  onReviewRecords: vi.fn(), onOpenInModel: vi.fn(),
};

describe("WorkspaceCard cleaned count presentation", () => {
  it("renders an explicit unavailable state for an unknown cleaned count", () => {
    render(<WorkspaceCard item={item} index={0} {...callbacks} />);
    expect(screen.getByText(/Cleaned — Count unavailable valid records/)).toBeInTheDocument();
  });
});
