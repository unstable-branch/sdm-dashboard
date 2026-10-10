import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSDMStore } from "@/stores/sdm-store";
import { selectWorkspaceFileForModel } from "./model-handoff";
import { ModelDataSource } from "@/components/model/model-data-source";
import type { WorkspaceFile } from "./types";

const cleanedCard: WorkspaceFile = {
  id: "raw-asset-uuid",
  rawAssetId: "raw-asset-uuid",
  fileId: "legacy-raw-file-id",
  fileName: "synthetic.csv",
  filePath: "legacy-raw-file-id",
  fileRows: 6000,
  fileCleaned: true,
  selectedSpecies: ["Species one"],
  cleanedAssetId: "cleaned-asset-uuid",
  cleanValidRecords: 1650,
  cleanLoading: false,
  cleanError: null,
};

const rawCard: WorkspaceFile = {
  ...cleanedCard,
  fileCleaned: false,
  cleanedAssetId: undefined,
  cleanValidRecords: undefined,
};

beforeEach(() => useSDMStore.getState().reset());
afterEach(() => cleanup());

describe("Data to Model cleaned occurrence handoff", () => {
  it("uses the canonical cleaned asset and renders cleaned counts without a legacy file id", () => {
    selectWorkspaceFileForModel(cleanedCard);

    const state = useSDMStore.getState();
    expect(state.rawAssetId).toBe("raw-asset-uuid");
    expect(state.cleanedAssetId).toBe("cleaned-asset-uuid");
    expect(state.cleanedOccurrence).toMatchObject({
      cleanedAssetId: "cleaned-asset-uuid",
      filePath: "",
      originalRows: 6000,
      validRecords: 1650,
    });
    expect(state.recordCount).toBe(6000);

    render(<ModelDataSource occurrenceFile={state.occurrenceFilePath} recordCount={state.recordCount} cleanedOccurrence={state.cleanedOccurrence} species={state.species} />);
    expect(screen.getByText("Cleaned occurrence data")).toBeTruthy();
    expect(screen.getByText("6,000 original → 1,650 cleaned records")).toBeTruthy();
    expect(screen.queryByText("Not cleaned.")).toBeNull();
  });

  it("keeps a historical cleaned count unknown instead of substituting raw rows", () => {
    const historicalCard = { ...cleanedCard, cleanValidRecords: undefined };
    selectWorkspaceFileForModel(historicalCard);
    const state = useSDMStore.getState();

    expect(state.rawAssetId).toBe("raw-asset-uuid");
    expect(state.cleanedAssetId).toBe("cleaned-asset-uuid");
    expect(state.cleanedOccurrence?.originalRows).toBe(6000);
    expect(state.cleanedOccurrence?.validRecords).toBeNull();
    render(<ModelDataSource occurrenceFile={state.occurrenceFilePath} recordCount={state.recordCount} cleanedOccurrence={state.cleanedOccurrence} species={state.species} />);
    expect(screen.getByText("6,000 original → cleaned count unavailable")).toBeTruthy();
    expect(screen.queryByText("6,000 original → 6,000 cleaned records")).toBeNull();
  });

  it("keeps an explicit null API cleaned count unknown while retaining cleaned asset identity", () => {
    const historicalCard = { ...cleanedCard, cleanValidRecords: null } as unknown as WorkspaceFile;
    selectWorkspaceFileForModel(historicalCard);
    const state = useSDMStore.getState();

    expect(state.cleanedAssetId).toBe("cleaned-asset-uuid");
    expect(state.cleanedOccurrence?.validRecords).toBeNull();
    render(<ModelDataSource occurrenceFile={state.occurrenceFilePath} recordCount={state.recordCount} cleanedOccurrence={state.cleanedOccurrence} species={state.species} />);
    expect(screen.getByText("6,000 original → cleaned count unavailable")).toBeTruthy();
    expect(screen.queryByText("6,000 original → 6,000 cleaned records")).toBeNull();
  });

  it("preserves zero valid records as cleaned state rather than falling back to raw count", () => {
    selectWorkspaceFileForModel({ ...cleanedCard, cleanValidRecords: 0 });
    const state = useSDMStore.getState();

    expect(state.cleanedOccurrence?.validRecords).toBe(0);
    render(<ModelDataSource occurrenceFile={state.occurrenceFilePath} recordCount={state.recordCount} cleanedOccurrence={state.cleanedOccurrence} species={state.species} />);
    expect(screen.getByText("6,000 original → 0 cleaned records")).toBeTruthy();
  });

  it("clears the prior cleaned occurrence when a raw card is selected", () => {
    selectWorkspaceFileForModel(cleanedCard);
    selectWorkspaceFileForModel(rawCard);
    const state = useSDMStore.getState();

    expect(state.cleanedAssetId).toBeNull();
    expect(state.cleanedOccurrence).toBeNull();
    expect(state.rawAssetId).toBe("raw-asset-uuid");
    render(<ModelDataSource occurrenceFile={state.occurrenceFilePath} recordCount={state.recordCount} cleanedOccurrence={state.cleanedOccurrence} species={state.species} />);
    expect(screen.getByText((_, element) => element?.textContent?.startsWith("Not cleaned.") ?? false)).toBeTruthy();
    expect(screen.queryByText("Cleaned occurrence data")).toBeNull();
  });
});
