import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchInput } from "@/components/ui/search-input";

describe("SearchInput", () => {
  it("renders with placeholder", () => {
    render(<SearchInput value="" onChange={() => {}} placeholder="Search species..." />);
    expect(screen.getByPlaceholderText("Search species...")).toBeTruthy();
  });

  it("calls onChange with debounced value", async () => {
    const onChange = vi.fn();
    vi.useFakeTimers();

    render(<SearchInput value="" onChange={onChange} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "test" } });

    vi.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledWith("test");

    vi.useRealTimers();
  });

  it("shows clear button when value exists", () => {
    render(<SearchInput value="test" onChange={() => {}} />);
    expect(screen.getByRole("button")).toBeTruthy();
  });

  it("does not show clear button when empty", () => {
    render(<SearchInput value="" onChange={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("clears value when clear button clicked", () => {
    const onChange = vi.fn();
    vi.useFakeTimers();

    render(<SearchInput value="" onChange={onChange} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "test" } });
    vi.advanceTimersByTime(200);

    const clearBtn = screen.getByRole("button");
    fireEvent.click(clearBtn);

    vi.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledWith("");

    vi.useRealTimers();
  });
});
