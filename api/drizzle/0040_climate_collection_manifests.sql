-- M2C1 Slice 1: immutable climate collection manifest vocabulary.
-- Existing input_assets rows remain unchanged; the new enum value is additive.

ALTER TYPE input_asset_kind ADD VALUE IF NOT EXISTS 'climate_collection';
