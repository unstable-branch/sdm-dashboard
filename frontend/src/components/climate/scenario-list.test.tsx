import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScenarioList } from "./scenario-list";

describe("ScenarioList", () => {
  it("does not offer path-derived deletion for immutable climate collections", () => {
    render(<ScenarioList
      scenarios={[{
        id: "current",
        type: "current",
        source: "worldclim",
        file_count: 19,
        size_bytes: 1024,
      }]}
      onRefresh={vi.fn()}
    />);

    expect(screen.queryByTitle("Delete scenario")).not.toBeInTheDocument();
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
  });
});
