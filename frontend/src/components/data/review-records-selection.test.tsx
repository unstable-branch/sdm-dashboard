import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { ReviewRecordsModal } from "./review-records-modal";

// DOM fixtures have no layout measurements. Keep the real table and row actions,
// supplying only the viewport measurements normally provided by the browser.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 36, end: (index + 1) * 36, size: 36 })),
    getTotalSize: () => count * 36,
  }),
}));
const props = {
  open: true,
  onClose: vi.fn(),
  records: [
    { longitude: 11, latitude: -11, source: "upload", species: "First species" },
    { longitude: 22, latitude: -22, source: "gbif", species: "Second species" },
    { longitude: 33, latitude: -33, source: "upload", species: "Third species" },
  ],
  sourceCounts: { upload: 2, gbif: 1 },
  ccLog: [],
  validRecords: 3,
  originalRows: 3,
};

describe("record preview selection identity", () => {
  it("discards preview selections and history when the record snapshot changes", () => {
    const { rerender } = render(<ReviewRecordsModal {...props} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Flag record" })[1]);
    rerender(<ReviewRecordsModal {...props} records={[{ longitude: 44, latitude: -44, source: "gbif", species: "Replacement species" }]} />);
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Flag record" }).closest("tr")).toHaveTextContent("Replacement species");
  });

  afterEach(() => vi.restoreAllMocks());

  it("exports the original selected row with valid quoting of multiline cells", async () => {
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fixture");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const records = [...props.records];
    records[1] = { ...records[1], species: "Second\nspecies" };
    render(<ReviewRecordsModal {...props} records={records} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Filter preview by source" }), { target: { value: "gbif" } });
    fireEvent.click(screen.getByRole("button", { name: "Flag record" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Filter preview by source" }), { target: { value: "upload" } });
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    const csv = await (createUrl.mock.calls[0][0] as Blob).text();
    expect(csv).toContain('22,-22,gbif,"Second\nspecies"');
    expect(csv).not.toContain("First species");
    expect(csv).not.toContain("Third species");
    expect(revokeUrl).toHaveBeenCalledWith("blob:fixture");
  });

  it("does not advertise dataset removal from a read-only preview", () => {
    render(<ReviewRecordsModal {...props} />);
    expect(screen.queryByRole("button", { name: "Remove flagged" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear flags" })).toBeInTheDocument();
  });

  it("restores cleared flags with one undo, including in Strict Mode", () => {
    render(<StrictMode><ReviewRecordsModal {...props} /></StrictMode>);
    fireEvent.click(screen.getAllByRole("button", { name: "Flag record" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Clear flags" }));
    expect(screen.queryByRole("button", { name: "Unflag record" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Unflag record" }).closest("tr")).toHaveTextContent("Second species");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("button", { name: "Unflag record" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("shows no rows in flagged-only mode when there are no manual flags", () => {
    render(<ReviewRecordsModal {...props} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Flagged only" }));
    expect(screen.getByText("No records match the current filter.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Flag record" })).not.toBeInTheDocument();
  });

  it("keeps a flag on the original record when the source filter changes", () => {
    render(<ReviewRecordsModal {...props} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Filter preview by source" }), { target: { value: "gbif" } });
    fireEvent.click(screen.getByRole("button", { name: "Flag record" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Filter preview by source" }), { target: { value: "all" } });
    expect(screen.getByRole("button", { name: "Unflag record" }).closest("tr")).toHaveTextContent("Second species");
    expect(screen.getAllByRole("button", { name: "Flag record" })).toHaveLength(2);
  });
});
