import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { ReviewRecordsModal } from "./review-records-modal";

vi.mock("./cleaning-table", () => ({
  CleaningTable: ({ title }: { title: string }) => <div>{title}</div>,
}));
const props = {
  open: true,
  onClose: vi.fn(),
  records: [{ longitude: 0, latitude: 0, source: "upload" }],
  sourceCounts: { upload: 1650 },
  ccLog: ["CoordinateCleaner flagged 7 records"],
  validRecords: 1650,
  originalRows: 6000,
};

describe("record review preview", () => {
  it("keeps keyboard focus inside the preview rather than returning to the page", async () => {
    const user = userEvent.setup();
    render(<><button>Outside page action</button><ReviewRecordsModal {...props} /></>);
    const close = screen.getByRole("button", { name: "Close record review" });
    await user.tab({ shift: true });
    expect(screen.getByRole("checkbox")).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    expect(screen.getByRole("button", { name: "Outside page action", hidden: true })).not.toHaveFocus();
  });

  it("preserves zero valid records and shows unavailable row detail honestly", () => {
    render(<ReviewRecordsModal {...props} records={[]} validRecords={0} sourceCounts={{}} />);
    expect(screen.getByText(/Loaded 0 preview rows; the cleaned dataset contains 0 valid records/)).toBeInTheDocument();
    expect(screen.getByText("No detailed record data available. Summary counts shown above.")).toBeInTheDocument();
  });

  it("names the dialog and close button, handles Escape, and restores opener focus", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<><button>View records</button><ReviewRecordsModal {...props} open={false} onClose={onClose} /></>);
    screen.getByRole("button", { name: "View records" }).focus();
    rerender(<><button>View records</button><ReviewRecordsModal {...props} onClose={onClose} /></>);
    expect(screen.getByRole("dialog", { name: "Review Records" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close record review" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<><button>View records</button><ReviewRecordsModal {...props} open={false} onClose={onClose} /></>);
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "View records" })).toHaveFocus());
  });

  it("distinguishes loaded preview rows from dataset counts and manual flags", () => {
    render(<ReviewRecordsModal {...props} />);
    expect(screen.getByText("Preview rows (1 shown / 1 loaded)")).toBeInTheDocument();
    expect(screen.getByText(/Loaded 1 preview rows; the cleaned dataset contains 1,650 valid records/)).toBeInTheDocument();
    expect(screen.getByText("Manual flags")).toBeInTheDocument();
    expect(screen.getByText(/CoordinateCleaner findings are recorded separately/)).toBeInTheDocument();
  });
});
