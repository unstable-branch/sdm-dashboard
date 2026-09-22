import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelConfigBiovars } from "./model-config-biovars";

describe("ModelConfigBiovars", () => {
  it("requires climate collections to be prepared before model submission", () => {
    render(<ModelConfigBiovars
      climateSource="worldclim"
      onClimateSourceChange={vi.fn()}
      climateRes={10}
      onClimateResChange={vi.fn()}
      biovars={[1]}
      missingBiovars={[]}
      climateCheckLoading={false}
      toggleBiovar={vi.fn()}
      aggregationFactor={1}
      chelsaExtras={[]}
      onChelsaExtrasChange={vi.fn()}
    />);

    expect(screen.queryByTestId("climate-auto-download")).not.toBeInTheDocument();
    expect(screen.getByText(/download and register climate data/i)).toBeInTheDocument();
  });
});
