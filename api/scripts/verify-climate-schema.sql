\set ON_ERROR_STOP on

BEGIN;

INSERT INTO users (id, email, password_hash, role, storage_quota_bytes)
VALUES ('10000000-0000-4000-8000-000000000010', 'climate-schema@example.invalid', 'synthetic', 'admin', NULL);

INSERT INTO input_assets (
  id, creator_user_id, scope, kind, storage_locator, state, content_sha256, content_size
) VALUES
  ('20000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000010', 'system', 'climate_raster', 'climate/schema-current-bio01.tif', 'ready', repeat('a', 64), 101),
  ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000010', 'system', 'climate_raster', 'climate/schema-current-bio02.tif', 'ready', repeat('b', 64), 102),
  ('20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000010', 'system', 'climate_raster', 'climate/schema-future-bio01.tif', 'ready', repeat('c', 64), 201),
  ('20000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000010', 'system', 'climate_raster', 'climate/schema-future-bio02.tif', 'ready', repeat('d', 64), 202),
  ('20000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000010', 'system', 'climate_raster', 'climate/schema-derived-bio01.tif', 'ready', repeat('f', 64), 301),
  ('20000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000010', 'system', 'climate_raster', 'climate/schema-derived-bio02.tif', 'ready', repeat('9', 64), 302);

INSERT INTO climate_collections (
  id, kind, created_by_user_id, provider, dataset, dataset_version, licence, attribution,
  source_evidence, expected_variable_keys, grid_fingerprint, grid_definition,
  baseline_start, baseline_end
) VALUES (
  '30000000-0000-4000-8000-000000000010', 'current_baseline',
  '10000000-0000-4000-8000-000000000010', 'Synthetic', 'BIO', '1', 'CC0',
  'Synthetic schema fixture', '{}', ARRAY['bio01', 'bio02'], repeat('1', 64), '{}',
  '1981', '2010'
);

INSERT INTO climate_collection_members (
  collection_id, asset_id, ordinal, variable_key, state, media_kind, byte_size, sha256,
  units, datatype, nodata_semantics, grid_fingerprint, validation_evidence, validated_at
) VALUES (
  '30000000-0000-4000-8000-000000000010', '20000000-0000-4000-8000-000000000011',
  1, 'bio01', 'validated', 'image/tiff', 101, repeat('a', 64), 'degC', 'float32',
  '{"kind":"nan"}', repeat('1', 64), '{"validator":"synthetic"}', now()
);

DO $$
BEGIN
  BEGIN
    UPDATE climate_collection_members SET validation_evidence = '[]'
    WHERE collection_id = '30000000-0000-4000-8000-000000000010' AND ordinal = 1;
    RAISE EXCEPTION 'validated member unexpectedly accepted non-object evidence';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

UPDATE climate_collections SET
  validation_state = 'valid', validation_report_sha256 = repeat('e', 64),
  validator_identity = 'synthetic-validator/1', validated_at = now()
WHERE id = '30000000-0000-4000-8000-000000000010';

DO $$
BEGIN
  BEGIN
    UPDATE climate_collections SET gcm = 'invalid-current-gcm'
    WHERE id = '30000000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'current collection unexpectedly accepted future metadata';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE climate_collections SET scenario_label = 'invalid current scenario'
    WHERE id = '30000000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'current collection unexpectedly accepted a scenario label';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE climate_collections SET baseline_start = '   '
    WHERE id = '30000000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'current collection unexpectedly accepted a blank baseline';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE climate_collections SET
      state = 'ready', manifest_schema_version = 1,
      manifest = sdm_build_climate_manifest(id, 1),
      manifest_sha256 = encode(digest(convert_to(sdm_build_climate_manifest(id, 1)::text, 'UTF8'), 'sha256'), 'hex'),
      published_by_user_id = '10000000-0000-4000-8000-000000000010', published_at = now()
    WHERE id = '30000000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'incomplete publication unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'climate collection members are incomplete or invalid' THEN RAISE; END IF;
  END;
END;
$$;

INSERT INTO climate_collection_members (
  collection_id, asset_id, ordinal, variable_key, state, media_kind, byte_size, sha256,
  units, datatype, nodata_semantics, grid_fingerprint, validation_evidence, validated_at
) VALUES (
  '30000000-0000-4000-8000-000000000010', '20000000-0000-4000-8000-000000000012',
   3, 'bio02', 'validated', 'image/tiff', 102, repeat('b', 64), 'degC', 'float32',
  '{"kind":"nan"}', repeat('1', 64), '{"validator":"synthetic"}', now()
);

DO $$
BEGIN
  BEGIN
    UPDATE climate_collections SET
      state = 'ready', manifest_schema_version = 1,
      manifest = sdm_build_climate_manifest(id, 1),
      manifest_sha256 = encode(digest(convert_to(sdm_build_climate_manifest(id, 1)::text, 'UTF8'), 'sha256'), 'hex'),
      published_by_user_id = '10000000-0000-4000-8000-000000000010', published_at = now()
    WHERE id = '30000000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'non-contiguous member publication unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'climate collection members are incomplete or invalid' THEN RAISE; END IF;
  END;
END;
$$;

UPDATE climate_collection_members SET ordinal = 2
WHERE collection_id = '30000000-0000-4000-8000-000000000010' AND variable_key = 'bio02';

DO $$
BEGIN
  BEGIN
    UPDATE climate_collections SET
      provider = 'Changed during publication',
      state = 'ready', manifest_schema_version = 1,
      manifest = sdm_build_climate_manifest(id, 1),
      manifest_sha256 = encode(digest(convert_to(sdm_build_climate_manifest(id, 1)::text, 'UTF8'), 'sha256'), 'hex'),
      published_by_user_id = '10000000-0000-4000-8000-000000000010', published_at = now()
    WHERE id = '30000000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'publication-time identity mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'climate collection identity cannot change during publication' THEN RAISE; END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE climate_collections SET
      state = 'ready', manifest_schema_version = 1,
      manifest = sdm_build_climate_manifest(id, 1), manifest_sha256 = repeat('f', 64),
      published_by_user_id = '10000000-0000-4000-8000-000000000010', published_at = now()
    WHERE id = '30000000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'invalid manifest hash unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'climate collection manifest hash is invalid' THEN RAISE; END IF;
  END;
END;
$$;

UPDATE climate_collections SET validator_identity = '   '
WHERE id = '30000000-0000-4000-8000-000000000010';
DO $$
BEGIN
  BEGIN
    UPDATE climate_collections SET
      state = 'ready', manifest_schema_version = 1,
      manifest = sdm_build_climate_manifest(id, 1),
      manifest_sha256 = encode(digest(convert_to(sdm_build_climate_manifest(id, 1)::text, 'UTF8'), 'sha256'), 'hex'),
      published_by_user_id = '10000000-0000-4000-8000-000000000010', published_at = now()
    WHERE id = '30000000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'publication unexpectedly accepted a blank validator identity';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;
UPDATE climate_collections SET validator_identity = 'synthetic-validator/1'
WHERE id = '30000000-0000-4000-8000-000000000010';

UPDATE climate_collections SET
  state = 'ready', manifest_schema_version = 1,
  manifest = sdm_build_climate_manifest(id, 1),
  manifest_sha256 = encode(digest(convert_to(sdm_build_climate_manifest(id, 1)::text, 'UTF8'), 'sha256'), 'hex'),
  published_by_user_id = '10000000-0000-4000-8000-000000000010', published_at = now()
WHERE id = '30000000-0000-4000-8000-000000000010';

DO $$
BEGIN
  BEGIN
    UPDATE climate_collections SET provider = 'Tampered'
    WHERE id = '30000000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'published identity mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'published climate collection identity is immutable' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO runs (id, model_id, config, climate_input_mode)
    VALUES ('40000000-0000-4000-8000-000000000010', 'glm', '{}', 'canonical');
    SET CONSTRAINTS runs_canonical_climate_binding_trigger IMMEDIATE;
    RAISE EXCEPTION 'canonical run without binding unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'canonical run requires a current climate binding' THEN RAISE; END IF;
  END;
END;
$$;

SET CONSTRAINTS runs_canonical_climate_binding_trigger DEFERRED;
INSERT INTO runs (id, model_id, config, climate_input_mode)
VALUES ('40000000-0000-4000-8000-000000000011', 'glm', '{}', 'canonical');
DO $$
BEGIN
  BEGIN
    INSERT INTO climate_run_bindings (
      run_id, role, collection_id, manifest_sha256, manifest_schema_version,
      execution_protocol_version, ordered_variable_keys, grid_fingerprint,
      baseline_period, scenario_label
    ) SELECT
      '40000000-0000-4000-8000-000000000011', 'current', id, manifest_sha256, manifest_schema_version,
      1, ARRAY['bio01', 'bio02'], grid_fingerprint, '1981/2010', 'invalid current scenario'
    FROM climate_collections WHERE id = '30000000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'current binding unexpectedly accepted future metadata';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;
INSERT INTO climate_run_bindings (
  run_id, role, collection_id, manifest_sha256, manifest_schema_version,
  execution_protocol_version, ordered_variable_keys, grid_fingerprint, baseline_period
) SELECT
  '40000000-0000-4000-8000-000000000011', 'current', id, manifest_sha256, manifest_schema_version,
  1, ARRAY['bio01', 'bio02'], grid_fingerprint, '1981/2010'
FROM climate_collections WHERE id = '30000000-0000-4000-8000-000000000010';

INSERT INTO climate_collections (
  id, kind, created_by_user_id, provider, dataset, dataset_version, licence, attribution,
  source_evidence, expected_variable_keys, grid_fingerprint, grid_definition,
  future_period, ssp, gcm, scenario_label, baseline_collection_id
) VALUES (
  '30000000-0000-4000-8000-000000000011', 'future_scenario',
  '10000000-0000-4000-8000-000000000010', 'Synthetic', 'CMIP6', '1', 'CC0',
  'Synthetic schema fixture', '{}', ARRAY['bio01', 'bio02'], repeat('1', 64), '{}',
  '2041-2060', 'SSP2-4.5', 'Synthetic-GCM', 'Synthetic future',
  '30000000-0000-4000-8000-000000000010'
);
DO $$
BEGIN
  BEGIN
    UPDATE climate_collections SET baseline_start = '1981', baseline_end = '2010'
    WHERE id = '30000000-0000-4000-8000-000000000011';
    RAISE EXCEPTION 'future collection unexpectedly accepted current baseline fields';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE climate_collections SET gcm = '   '
    WHERE id = '30000000-0000-4000-8000-000000000011';
    RAISE EXCEPTION 'future collection unexpectedly accepted a blank GCM';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;
INSERT INTO climate_collection_members (
  collection_id, asset_id, ordinal, variable_key, state, media_kind, byte_size, sha256,
  units, datatype, nodata_semantics, grid_fingerprint, validation_evidence, validated_at
) VALUES
  ('30000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000013',
   1, 'bio01', 'validated', 'image/tiff', 201, repeat('c', 64), 'kelvin', 'float32',
   '{"kind":"nan"}', repeat('1', 64), '{"validator":"synthetic"}', now()),
  ('30000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000014',
   2, 'bio02', 'validated', 'image/tiff', 202, repeat('d', 64), 'degC', 'float32',
   '{"kind":"nan"}', repeat('1', 64), '{"validator":"synthetic"}', now());

UPDATE climate_collections SET
  validation_state = 'valid', validation_report_sha256 = repeat('9', 64),
  validator_identity = 'synthetic-validator/1', validated_at = now()
WHERE id = '30000000-0000-4000-8000-000000000011';

DO $$
BEGIN
  BEGIN
    UPDATE climate_collections SET
      state = 'ready', manifest_schema_version = 1,
      manifest = sdm_build_climate_manifest(id, 1),
      manifest_sha256 = encode(digest(convert_to(sdm_build_climate_manifest(id, 1)::text, 'UTF8'), 'sha256'), 'hex'),
      published_by_user_id = '10000000-0000-4000-8000-000000000010', published_at = now()
    WHERE id = '30000000-0000-4000-8000-000000000011';
    RAISE EXCEPTION 'incompatible future semantics unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'future climate variable semantics are incompatible with the baseline' THEN RAISE; END IF;
  END;
END;
$$;

UPDATE climate_collection_members SET units = 'degC'
WHERE collection_id = '30000000-0000-4000-8000-000000000011' AND variable_key = 'bio01';
UPDATE climate_collections SET
  state = 'ready', manifest_schema_version = 1,
  manifest = sdm_build_climate_manifest(id, 1),
  manifest_sha256 = encode(digest(convert_to(sdm_build_climate_manifest(id, 1)::text, 'UTF8'), 'sha256'), 'hex'),
  published_by_user_id = '10000000-0000-4000-8000-000000000010', published_at = now()
WHERE id = '30000000-0000-4000-8000-000000000011';

INSERT INTO climate_run_bindings (
  run_id, role, collection_id, manifest_sha256, manifest_schema_version,
  execution_protocol_version, ordered_variable_keys, grid_fingerprint,
  baseline_collection_id, baseline_manifest_sha256, baseline_period,
  future_period, ssp, gcm, scenario_label
) SELECT
  '40000000-0000-4000-8000-000000000011', 'future_primary', future.id,
  future.manifest_sha256, future.manifest_schema_version, 1, ARRAY['bio01', 'bio02'],
  future.grid_fingerprint, baseline.id, baseline.manifest_sha256, '1981/2010',
  future.future_period, future.ssp, future.gcm, future.scenario_label
FROM climate_collections future
JOIN climate_collections baseline ON baseline.id = future.baseline_collection_id
WHERE future.id = '30000000-0000-4000-8000-000000000011';

INSERT INTO climate_collections (
  id, kind, created_by_user_id, provider, dataset, dataset_version, licence, attribution,
  source_evidence, expected_variable_keys, grid_fingerprint, grid_definition,
  future_period, ssp, scenario_label, baseline_collection_id,
  derivation_algorithm_id, derivation_algorithm_version, derivation_parameters,
  missing_cell_policy, derivation_software_identity
) VALUES (
  '30000000-0000-4000-8000-000000000012', 'derived_future',
  '10000000-0000-4000-8000-000000000010', 'Synthetic', 'CMIP6 average', '1', 'CC0',
  'Synthetic schema fixture', '{}', ARRAY['bio01', 'bio02'], repeat('1', 64), '{}',
  '2041-2060', 'SSP2-4.5', 'Synthetic derived future',
  '30000000-0000-4000-8000-000000000010',
  'grid_transform', '1', '{"resampling":"none"}', 'require_all_parents',
  '{"implementation":"synthetic-validator/1"}'
);
DO $$
BEGIN
  BEGIN
    UPDATE climate_collections SET gcm = 'invalid-derived-gcm'
    WHERE id = '30000000-0000-4000-8000-000000000012';
    RAISE EXCEPTION 'derived collection unexpectedly accepted a direct GCM';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE climate_collections SET derivation_algorithm_id = '   '
    WHERE id = '30000000-0000-4000-8000-000000000012';
    RAISE EXCEPTION 'derived collection unexpectedly accepted a blank algorithm';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE climate_collections SET derivation_parameters = '[]'
    WHERE id = '30000000-0000-4000-8000-000000000012';
    RAISE EXCEPTION 'derived collection unexpectedly accepted non-object parameters';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;
INSERT INTO climate_collection_parents (
  child_collection_id, parent_ordinal, parent_collection_id, parent_manifest_sha256
) SELECT
  '30000000-0000-4000-8000-000000000012', 1, id, manifest_sha256
FROM climate_collections WHERE id = '30000000-0000-4000-8000-000000000011';
INSERT INTO climate_collection_members (
  collection_id, asset_id, ordinal, variable_key, state, media_kind, byte_size, sha256,
  units, datatype, nodata_semantics, grid_fingerprint, validation_evidence, validated_at
) VALUES
  ('30000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000015',
   1, 'bio01', 'validated', 'image/tiff', 301, repeat('f', 64), 'degC', 'float32',
   '{"kind":"nan"}', repeat('1', 64), '{"validator":"synthetic"}', now()),
  ('30000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000016',
   2, 'bio02', 'validated', 'image/tiff', 302, repeat('9', 64), 'degC', 'float32',
   '{"kind":"nan"}', repeat('1', 64), '{"validator":"synthetic"}', now());
UPDATE climate_collections SET
  validation_state = 'valid', validation_report_sha256 = repeat('6', 64),
  validator_identity = 'synthetic-validator/1', validated_at = now()
WHERE id = '30000000-0000-4000-8000-000000000012';
UPDATE climate_collections SET
  state = 'ready', manifest_schema_version = 1,
  manifest = sdm_build_climate_manifest(id, 1),
  manifest_sha256 = encode(digest(convert_to(sdm_build_climate_manifest(id, 1)::text, 'UTF8'), 'sha256'), 'hex'),
  published_by_user_id = '10000000-0000-4000-8000-000000000010', published_at = now()
WHERE id = '30000000-0000-4000-8000-000000000012';
INSERT INTO climate_run_bindings (
  run_id, role, collection_id, manifest_sha256, manifest_schema_version,
  execution_protocol_version, ordered_variable_keys, grid_fingerprint,
  baseline_collection_id, baseline_manifest_sha256, baseline_period,
  future_period, ssp, gcm, scenario_label
) SELECT
  '40000000-0000-4000-8000-000000000011', 'future_secondary', derived.id,
  derived.manifest_sha256, derived.manifest_schema_version, 1, ARRAY['bio01', 'bio02'],
  derived.grid_fingerprint, baseline.id, baseline.manifest_sha256, '1981/2010',
  derived.future_period, derived.ssp, derived.gcm, derived.scenario_label
FROM climate_collections derived
JOIN climate_collections baseline ON baseline.id = derived.baseline_collection_id
WHERE derived.id = '30000000-0000-4000-8000-000000000012';

DO $$
BEGIN
  BEGIN
    UPDATE climate_collection_members
    SET collection_id = '30000000-0000-4000-8000-000000000011'
    WHERE collection_id = '30000000-0000-4000-8000-000000000010' AND ordinal = 1;
    RAISE EXCEPTION 'published member move unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'climate members cannot move between collections' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE climate_collection_parents
    SET child_collection_id = '30000000-0000-4000-8000-000000000011'
    WHERE child_collection_id = '30000000-0000-4000-8000-000000000012';
    RAISE EXCEPTION 'published lineage move unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'climate lineage cannot move between collections' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE climate_collections SET
      state = 'quarantined', quarantined_at = now(), quarantine_reason = 'out-of-order verification'
    WHERE id = '30000000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'baseline quarantine with ready dependents unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'dependent climate collections must be quarantined first' THEN RAISE; END IF;
  END;
END;
$$;

UPDATE climate_collections SET
  state = 'quarantined', quarantined_at = now(), quarantine_reason = 'synthetic verification'
WHERE id = '30000000-0000-4000-8000-000000000012';
UPDATE climate_collections SET
  state = 'quarantined', quarantined_at = now(), quarantine_reason = 'synthetic verification'
WHERE id = '30000000-0000-4000-8000-000000000011';
UPDATE climate_collections SET
  state = 'quarantined', quarantined_at = now(), quarantine_reason = 'synthetic verification'
WHERE id = '30000000-0000-4000-8000-000000000010';

DO $$
BEGIN
  BEGIN
    UPDATE input_assets SET state = 'quarantined', quarantined_at = now()
    WHERE id = '20000000-0000-4000-8000-000000000011';
    RAISE EXCEPTION 'run-bound climate bytes were not retained';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'run-bound climate bytes must be retained' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE climate_collections SET state = 'deleted', deleted_at = now(), deletion_receipt = '{}'
    WHERE id = '30000000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'referenced collection deletion unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'referenced climate collections cannot be deleted' THEN RAISE; END IF;
  END;
END;
$$;

DO $$
BEGIN
  IF (SELECT count(*) FROM climate_variable_catalog WHERE variable_key ~ '^bio(0[1-9]|1[0-9])$') <> 19 THEN
    RAISE EXCEPTION 'BIO variable catalog is incomplete';
  END IF;
  IF (SELECT count(*) FROM climate_run_bindings WHERE run_id = '40000000-0000-4000-8000-000000000011') <> 3 THEN
    RAISE EXCEPTION 'canonical current/future bindings are incomplete';
  END IF;
END;
$$;

ROLLBACK;
