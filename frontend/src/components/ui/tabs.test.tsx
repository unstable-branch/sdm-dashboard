import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

function Fixture() {
  return (
    <Tabs defaultValue="one">
      <TabsList aria-label="Fixture views">
        <TabsTrigger value="one">First</TabsTrigger>
        <TabsTrigger value="two">Second</TabsTrigger>
      </TabsList>
      <TabsContent value="one">First content</TabsContent>
      <TabsContent value="two">Second content</TabsContent>
    </Tabs>
  );
}

describe("shared tabs accessibility", () => {
  it("does not submit an enclosing form when a tab is clicked", () => {
    const submit = vi.fn();
    render(<form onSubmit={event => { event.preventDefault(); submit(); }}><Fixture /></form>);
    fireEvent.click(screen.getByRole("tab", { name: "Second" }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Second" })).toHaveAttribute("type", "button");
  });

  it("labels the tab group", () => {
    render(<Fixture />);
    expect(screen.getByRole("tablist", { name: "Fixture views" })).toBeInTheDocument();
  });

  it("wraps arrow focus and supports Home and End without changing the active panel", () => {
    render(<Fixture />);
    const first = screen.getByRole("tab", { name: "First" });
    const second = screen.getByRole("tab", { name: "Second" });
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "ArrowRight" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "End" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "Home" });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute("aria-selected", "true");
  });

  it("uses distinct associations when separate tab groups reuse values", () => {
    render(<><Fixture /><Fixture /></>);
    const firstTabs = screen.getAllByRole("tab", { name: "First" });
    expect(firstTabs[0].id).not.toBe(firstTabs[1].id);
    for (const tab of firstTabs) {
      const panel = document.getElementById(tab.getAttribute("aria-controls")!);
      expect(panel).toHaveAttribute("aria-labelledby", tab.id);
    }
  });

  it.each(["Enter", " "])("moves focus manually and activates only on %j", key => {
    render(<Fixture />);
    const first = screen.getByRole("tab", { name: "First" });
    const second = screen.getByRole("tab", { name: "Second" });
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(second).toHaveFocus();
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "First" })).toBeVisible();
    fireEvent.keyDown(second, { key });
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Second" })).toBeVisible();
  });

  it("associates tabs and panels with selected state and a single keyboard entry point", () => {
    render(<Fixture />);
    const first = screen.getByRole("tab", { name: "First" });
    const second = screen.getByRole("tab", { name: "Second" });
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("aria-selected", "false");
    expect(second).toHaveAttribute("tabindex", "-1");
    const panel = screen.getByRole("tabpanel", { name: "First" });
    expect(first).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", first.id);
    expect(panel).toHaveAttribute("tabindex", "0");
    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Second" })).toHaveTextContent("Second content");
    expect(screen.getByText("First content")).not.toBeVisible();
  });
});
