import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TargetGroupBiasInput } from "./target-group-bias-input";

describe("TargetGroupBiasInput", () => {
  it("captures a target-group file for opaque upload on submit", () => {
    const onChange = vi.fn();
    render(<TargetGroupBiasInput file={null} onChange={onChange} />);
    const file = new File(["lon,lat\n150,-23"], "background.csv", { type: "text/csv" });

    fireEvent.change(screen.getByLabelText("Target-group occurrence file"), { target: { files: [file] } });

    expect(onChange).toHaveBeenCalledWith(file);
  });
});
