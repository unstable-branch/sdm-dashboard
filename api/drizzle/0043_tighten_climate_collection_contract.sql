-- Forward repair for databases that applied a pre-final local 0042. Keep this
-- migration additive in history rather than rewriting the applied migration.
CREATE OR REPLACE FUNCTION sdm_build_climate_manifest(collection_uuid uuid, schema_version integer)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
	SELECT jsonb_build_object(
		'manifestSchemaVersion', schema_version,
		'collectionId', c."id",
		'kind', c."kind",
		'provider', c."provider",
		'dataset', c."dataset",
		'datasetVersion', c."dataset_version",
		'licence', c."licence",
		'attribution', c."attribution",
		'sourceEvidence', c."source_evidence",
		'expectedVariableKeys', c."expected_variable_keys",
		'grid', jsonb_build_object(
			'fingerprint', c."grid_fingerprint",
			'definition', c."grid_definition"
		),
		'temporal', jsonb_strip_nulls(jsonb_build_object(
			'baselineStart', c."baseline_start",
			'baselineEnd', c."baseline_end",
			'futurePeriod', c."future_period",
			'ssp', c."ssp",
			'gcm', c."gcm",
			'scenarioLabel', c."scenario_label",
			'baselineCollectionId', c."baseline_collection_id"
		)),
		'derivation', CASE WHEN c."kind" = 'derived_future' THEN jsonb_build_object(
			'algorithmId', c."derivation_algorithm_id",
			'algorithmVersion', c."derivation_algorithm_version",
			'parameters', c."derivation_parameters",
			'missingCellPolicy', c."missing_cell_policy",
			'softwareIdentity', c."derivation_software_identity"
		) ELSE NULL END,
		'validation', jsonb_build_object(
			'reportSha256', c."validation_report_sha256",
			'validatorIdentity', c."validator_identity",
			'validatedAt', c."validated_at"
		),
		'members', COALESCE((
			SELECT jsonb_agg(jsonb_build_object(
				'ordinal', m."ordinal",
				'variableKey', m."variable_key",
				'assetId', m."asset_id",
				'storageIdentity', a."id",
				'mediaKind', m."media_kind",
				'byteSize', m."byte_size",
				'sha256', m."sha256",
				'units', m."units",
				'datatype', m."datatype",
				'scaleFactor', m."scale_factor",
				'addOffset', m."add_offset",
				'nodataSemantics', m."nodata_semantics",
				'gridFingerprint', m."grid_fingerprint",
				'lifecycleState', m."state",
				'validationEvidence', m."validation_evidence"
			) ORDER BY m."ordinal")
			FROM "climate_collection_members" m
			JOIN "input_assets" a ON a."id" = m."asset_id"
			WHERE m."collection_id" = c."id"
		), '[]'::jsonb),
		'parents', COALESCE((
			SELECT jsonb_agg(jsonb_build_object(
				'ordinal', p."parent_ordinal",
				'collectionId', p."parent_collection_id",
				'manifestSha256', p."parent_manifest_sha256"
			) ORDER BY p."parent_ordinal")
			FROM "climate_collection_parents" p
			WHERE p."child_collection_id" = c."id"
		), '[]'::jsonb)
	)
	FROM "climate_collections" c
	WHERE c."id" = collection_uuid;
$$;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "climate_collections" WHERE NOT (
			("kind" = 'current_baseline' AND "baseline_start" IS NOT NULL AND length(btrim("baseline_start")) > 0 AND "baseline_end" IS NOT NULL AND length(btrim("baseline_end")) > 0 AND "future_period" IS NULL AND "ssp" IS NULL AND "gcm" IS NULL AND "scenario_label" IS NULL AND "baseline_collection_id" IS NULL)
			OR ("kind" IN ('future_scenario', 'derived_future') AND "baseline_start" IS NULL AND "baseline_end" IS NULL AND "future_period" IS NOT NULL AND length(btrim("future_period")) > 0 AND "ssp" IS NOT NULL AND length(btrim("ssp")) > 0 AND "scenario_label" IS NOT NULL AND length(btrim("scenario_label")) > 0 AND "baseline_collection_id" IS NOT NULL)
		) OR NOT (
			("kind" = 'future_scenario' AND "gcm" IS NOT NULL AND length(btrim("gcm")) > 0)
			OR ("kind" <> 'future_scenario' AND "gcm" IS NULL)
		) OR NOT (
			("kind" = 'derived_future' AND "derivation_algorithm_id" IS NOT NULL AND length(btrim("derivation_algorithm_id")) > 0 AND "derivation_algorithm_version" IS NOT NULL AND length(btrim("derivation_algorithm_version")) > 0 AND "derivation_parameters" IS NOT NULL AND jsonb_typeof("derivation_parameters") = 'object' AND "missing_cell_policy" IS NOT NULL AND length(btrim("missing_cell_policy")) > 0 AND "derivation_software_identity" IS NOT NULL AND jsonb_typeof("derivation_software_identity") = 'object')
			OR ("kind" <> 'derived_future' AND "derivation_algorithm_id" IS NULL AND "derivation_algorithm_version" IS NULL AND "derivation_parameters" IS NULL AND "missing_cell_policy" IS NULL AND "derivation_software_identity" IS NULL)
		)
	) THEN
		RAISE EXCEPTION 'climate 0043 preflight failed: repair or quarantine collections with contradictory or blank kind metadata';
	END IF;
	IF EXISTS (
		SELECT 1 FROM "climate_collections"
		WHERE "state" = 'ready' AND ("validator_identity" IS NULL OR length(btrim("validator_identity")) = 0)
	) THEN
		RAISE EXCEPTION 'climate 0043 preflight failed: repair ready collections with blank validator identity';
	END IF;
	IF EXISTS (
		SELECT 1 FROM "climate_collection_members"
		WHERE "state" = 'validated' AND ("validation_evidence" IS NULL OR jsonb_typeof("validation_evidence") <> 'object')
	) THEN
		RAISE EXCEPTION 'climate 0043 preflight failed: repair validated members with malformed validation evidence';
	END IF;
	IF EXISTS (
		SELECT 1 FROM "climate_run_bindings" WHERE NOT (
			length(btrim("baseline_period")) > 0 AND (
				("role" = 'current' AND "baseline_collection_id" IS NULL AND "baseline_manifest_sha256" IS NULL AND "future_period" IS NULL AND "ssp" IS NULL AND "gcm" IS NULL AND "scenario_label" IS NULL)
				OR ("role" IN ('future_primary', 'future_secondary') AND "baseline_collection_id" IS NOT NULL AND "baseline_manifest_sha256" IS NOT NULL AND "future_period" IS NOT NULL AND length(btrim("future_period")) > 0 AND "ssp" IS NOT NULL AND length(btrim("ssp")) > 0 AND "scenario_label" IS NOT NULL AND length(btrim("scenario_label")) > 0)
			)
		)
	) THEN
		RAISE EXCEPTION 'climate 0043 preflight failed: repair run bindings with contradictory or blank role metadata';
	END IF;
	IF EXISTS (
		SELECT 1
		FROM "climate_collections" c
		WHERE c."state" = 'ready' AND (
			c."validation_state" <> 'valid'
			OR c."validation_report_sha256" IS NULL
			OR c."validated_at" IS NULL
			OR c."manifest_schema_version" IS NULL
			OR c."manifest_sha256" IS NULL
			OR c."manifest" IS DISTINCT FROM sdm_build_climate_manifest(c."id", c."manifest_schema_version")
			OR c."manifest_sha256" IS DISTINCT FROM encode(digest(convert_to(sdm_build_climate_manifest(c."id", c."manifest_schema_version")::text, 'UTF8'), 'sha256'), 'hex')
			OR c."expected_variable_keys" IS DISTINCT FROM ARRAY(
				SELECT m."variable_key"::text FROM "climate_collection_members" m
				WHERE m."collection_id" = c."id" ORDER BY m."ordinal"
			)
			OR ARRAY(
				SELECT m."ordinal" FROM "climate_collection_members" m
				WHERE m."collection_id" = c."id" ORDER BY m."ordinal"
			) IS DISTINCT FROM ARRAY(SELECT generate_series(1, cardinality(c."expected_variable_keys")))
			OR EXISTS (
				SELECT 1
				FROM "climate_collection_members" m
				JOIN "input_assets" a ON a."id" = m."asset_id"
				LEFT JOIN "climate_variable_catalog" v ON v."variable_key" = m."variable_key"
				WHERE m."collection_id" = c."id" AND (
					m."state" <> 'validated'
					OR m."grid_fingerprint" <> c."grid_fingerprint"
					OR a."scope" <> 'system'
					OR a."kind"::text <> 'climate_raster'
					OR a."state" <> 'ready'
					OR a."content_sha256" IS DISTINCT FROM m."sha256"
					OR a."content_size" IS DISTINCT FROM m."byte_size"
					OR v."active" IS DISTINCT FROM true
				)
			)
		)
	) THEN
		RAISE EXCEPTION 'climate 0043 preflight failed: repair ready collections with invalid members or manifests';
	END IF;
	IF EXISTS (
		SELECT 1
		FROM "climate_collections" c
		LEFT JOIN "climate_collections" b ON b."id" = c."baseline_collection_id"
		WHERE c."state" = 'ready' AND c."kind" IN ('future_scenario', 'derived_future') AND (
			b."id" IS NULL
			OR b."state" <> 'ready'
			OR b."kind" <> 'current_baseline'
			OR b."grid_fingerprint" <> c."grid_fingerprint"
			OR b."expected_variable_keys" <> c."expected_variable_keys"
			OR EXISTS (
				SELECT 1
				FROM "climate_collection_members" fm
				LEFT JOIN "climate_collection_members" bm
					ON bm."collection_id" = c."baseline_collection_id" AND bm."variable_key" = fm."variable_key"
				WHERE fm."collection_id" = c."id" AND (
					bm."id" IS NULL
					OR fm."units" IS DISTINCT FROM bm."units"
					OR fm."datatype" IS DISTINCT FROM bm."datatype"
					OR fm."scale_factor" IS DISTINCT FROM bm."scale_factor"
					OR fm."add_offset" IS DISTINCT FROM bm."add_offset"
					OR fm."nodata_semantics" IS DISTINCT FROM bm."nodata_semantics"
				)
			)
		)
	) THEN
		RAISE EXCEPTION 'climate 0043 preflight failed: repair future collections with incompatible baselines';
	END IF;
	IF EXISTS (
		WITH RECURSIVE lineage("root_id", "current_id", "path", "has_cycle") AS (
			SELECT p."child_collection_id", p."parent_collection_id",
				ARRAY[p."child_collection_id", p."parent_collection_id"],
				p."parent_collection_id" = p."child_collection_id"
			FROM "climate_collection_parents" p
			UNION ALL
			SELECT l."root_id", p."parent_collection_id",
				l."path" || p."parent_collection_id",
				p."parent_collection_id" = ANY(l."path")
			FROM lineage l
			JOIN "climate_collection_parents" p ON p."child_collection_id" = l."current_id"
			WHERE NOT l."has_cycle"
		)
		SELECT 1 FROM lineage WHERE "has_cycle"
	) THEN
		RAISE EXCEPTION 'climate 0043 preflight failed: repair climate collection lineage cycles';
	END IF;
	IF EXISTS (
		SELECT 1
		FROM "climate_collections" c
		WHERE c."state" = 'ready' AND ((c."kind" <> 'derived_future' AND EXISTS (
			SELECT 1 FROM "climate_collection_parents" p WHERE p."child_collection_id" = c."id"
		)) OR (c."kind" = 'derived_future' AND (
			NOT EXISTS (SELECT 1 FROM "climate_collection_parents" p WHERE p."child_collection_id" = c."id")
			OR ARRAY(
				SELECT p."parent_ordinal" FROM "climate_collection_parents" p
				WHERE p."child_collection_id" = c."id" ORDER BY p."parent_ordinal"
			) IS DISTINCT FROM ARRAY(
				SELECT generate_series(1, (SELECT count(*)::integer FROM "climate_collection_parents" p WHERE p."child_collection_id" = c."id"))
			)
			OR EXISTS (
				SELECT 1
				FROM "climate_collection_parents" p
				LEFT JOIN "climate_collections" pc ON pc."id" = p."parent_collection_id"
				WHERE p."child_collection_id" = c."id" AND (
					pc."id" IS NULL
					OR pc."state" <> 'ready'
					OR pc."kind" <> 'future_scenario'
					OR pc."manifest_sha256" IS DISTINCT FROM p."parent_manifest_sha256"
					OR pc."grid_fingerprint" <> c."grid_fingerprint"
					OR pc."expected_variable_keys" <> c."expected_variable_keys"
					OR pc."future_period" IS DISTINCT FROM c."future_period"
					OR pc."ssp" IS DISTINCT FROM c."ssp"
					OR pc."baseline_collection_id" IS DISTINCT FROM c."baseline_collection_id"
				)
			)
			OR EXISTS (
				SELECT 1
				FROM "climate_collection_members" cm
				JOIN "climate_collection_parents" p ON p."child_collection_id" = c."id"
				JOIN "climate_collection_members" pm
					ON pm."collection_id" = p."parent_collection_id" AND pm."asset_id" = cm."asset_id"
				WHERE cm."collection_id" = c."id"
			)
			OR (c."derivation_algorithm_id" = 'multi_gcm_average' AND (
				(SELECT count(*) FROM "climate_collection_parents" p WHERE p."child_collection_id" = c."id") < 2
				OR (SELECT count(DISTINCT pc."gcm") FROM "climate_collection_parents" p JOIN "climate_collections" pc ON pc."id" = p."parent_collection_id" WHERE p."child_collection_id" = c."id") < 2
			))
		)))
	) THEN
		RAISE EXCEPTION 'climate 0043 preflight failed: repair invalid climate collection lineage';
	END IF;
	IF EXISTS (
		SELECT 1
		FROM "climate_run_bindings" rb
		LEFT JOIN "runs" r ON r."id" = rb."run_id"
		LEFT JOIN "climate_collections" c ON c."id" = rb."collection_id"
		WHERE r."id" IS NULL
			OR r."climate_input_mode" <> 'canonical'
			OR c."id" IS NULL
			OR c."state" <> 'ready'
			OR c."manifest_sha256" IS DISTINCT FROM rb."manifest_sha256"
			OR c."manifest_schema_version" IS DISTINCT FROM rb."manifest_schema_version"
			OR c."grid_fingerprint" IS DISTINCT FROM rb."grid_fingerprint"
			OR rb."ordered_variable_keys" IS DISTINCT FROM ARRAY(
				SELECT m."variable_key"::text
				FROM "climate_collection_members" m
				WHERE m."collection_id" = rb."collection_id" AND m."variable_key" = ANY(rb."ordered_variable_keys")
				ORDER BY m."ordinal"
			)
			OR (rb."role" = 'current' AND (
				c."kind" <> 'current_baseline'
				OR rb."baseline_period" IS DISTINCT FROM c."baseline_start" || '/' || c."baseline_end"
			))
			OR (rb."role" IN ('future_primary', 'future_secondary') AND (
				c."kind" NOT IN ('future_scenario', 'derived_future')
				OR rb."baseline_collection_id" IS DISTINCT FROM c."baseline_collection_id"
				OR rb."future_period" IS DISTINCT FROM c."future_period"
				OR rb."ssp" IS DISTINCT FROM c."ssp"
				OR rb."gcm" IS DISTINCT FROM c."gcm"
				OR rb."scenario_label" IS DISTINCT FROM c."scenario_label"
				OR NOT EXISTS (
					SELECT 1
					FROM "climate_run_bindings" current_rb
					WHERE current_rb."run_id" = rb."run_id" AND current_rb."role" = 'current'
						AND current_rb."collection_id" = rb."baseline_collection_id"
						AND current_rb."manifest_sha256" = rb."baseline_manifest_sha256"
						AND current_rb."grid_fingerprint" = rb."grid_fingerprint"
						AND current_rb."ordered_variable_keys" = rb."ordered_variable_keys"
						AND current_rb."baseline_period" = rb."baseline_period"
				)
			))
	) THEN
		RAISE EXCEPTION 'climate 0043 preflight failed: repair climate run bindings with invalid sealed identity';
	END IF;
	IF EXISTS (
		SELECT 1 FROM "runs" r
		WHERE r."climate_input_mode" = 'canonical' AND NOT EXISTS (
			SELECT 1 FROM "climate_run_bindings" rb WHERE rb."run_id" = r."id" AND rb."role" = 'current'
		)
	) THEN
		RAISE EXCEPTION 'climate 0043 preflight failed: repair canonical runs without a current climate binding';
	END IF;
END;
$$;
--> statement-breakpoint
ALTER TABLE "climate_collections" DROP CONSTRAINT IF EXISTS "climate_collections_kind_ck";--> statement-breakpoint
ALTER TABLE "climate_collections" DROP CONSTRAINT IF EXISTS "climate_collections_gcm_ck";--> statement-breakpoint
ALTER TABLE "climate_collections" DROP CONSTRAINT IF EXISTS "climate_collections_derivation_ck";--> statement-breakpoint
ALTER TABLE "climate_collections" DROP CONSTRAINT IF EXISTS "climate_collections_ready_ck";--> statement-breakpoint
ALTER TABLE "climate_collection_members" DROP CONSTRAINT IF EXISTS "climate_collection_members_validated_ck";--> statement-breakpoint
ALTER TABLE "climate_run_bindings" DROP CONSTRAINT IF EXISTS "climate_run_bindings_role_ck";--> statement-breakpoint
ALTER TABLE "climate_collections" ADD CONSTRAINT "climate_collections_kind_ck" CHECK (("kind" = 'current_baseline' AND "baseline_start" IS NOT NULL AND length(btrim("baseline_start")) > 0 AND "baseline_end" IS NOT NULL AND length(btrim("baseline_end")) > 0 AND "future_period" IS NULL AND "ssp" IS NULL AND "gcm" IS NULL AND "scenario_label" IS NULL AND "baseline_collection_id" IS NULL) OR ("kind" IN ('future_scenario', 'derived_future') AND "baseline_start" IS NULL AND "baseline_end" IS NULL AND "future_period" IS NOT NULL AND length(btrim("future_period")) > 0 AND "ssp" IS NOT NULL AND length(btrim("ssp")) > 0 AND "scenario_label" IS NOT NULL AND length(btrim("scenario_label")) > 0 AND "baseline_collection_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "climate_collections" ADD CONSTRAINT "climate_collections_gcm_ck" CHECK (("kind" = 'future_scenario' AND "gcm" IS NOT NULL AND length(btrim("gcm")) > 0) OR ("kind" <> 'future_scenario' AND "gcm" IS NULL));--> statement-breakpoint
ALTER TABLE "climate_collections" ADD CONSTRAINT "climate_collections_derivation_ck" CHECK (("kind" = 'derived_future' AND "derivation_algorithm_id" IS NOT NULL AND length(btrim("derivation_algorithm_id")) > 0 AND "derivation_algorithm_version" IS NOT NULL AND length(btrim("derivation_algorithm_version")) > 0 AND "derivation_parameters" IS NOT NULL AND jsonb_typeof("derivation_parameters") = 'object' AND "missing_cell_policy" IS NOT NULL AND length(btrim("missing_cell_policy")) > 0 AND "derivation_software_identity" IS NOT NULL AND jsonb_typeof("derivation_software_identity") = 'object') OR ("kind" <> 'derived_future' AND "derivation_algorithm_id" IS NULL AND "derivation_algorithm_version" IS NULL AND "derivation_parameters" IS NULL AND "missing_cell_policy" IS NULL AND "derivation_software_identity" IS NULL));--> statement-breakpoint
ALTER TABLE "climate_collections" ADD CONSTRAINT "climate_collections_ready_ck" CHECK ("state" <> 'ready' OR ("validation_state" = 'valid' AND "validation_report_sha256" IS NOT NULL AND "validator_identity" IS NOT NULL AND length(btrim("validator_identity")) > 0 AND "validated_at" IS NOT NULL AND "manifest_schema_version" IS NOT NULL AND "manifest_sha256" IS NOT NULL AND "manifest" IS NOT NULL AND "published_by_user_id" IS NOT NULL AND "published_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "climate_collection_members" ADD CONSTRAINT "climate_collection_members_validated_ck" CHECK ("state" <> 'validated' OR ("validation_evidence" IS NOT NULL AND jsonb_typeof("validation_evidence") = 'object' AND "validated_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "climate_run_bindings" ADD CONSTRAINT "climate_run_bindings_role_ck" CHECK (length(btrim("baseline_period")) > 0 AND (("role" = 'current' AND "baseline_collection_id" IS NULL AND "baseline_manifest_sha256" IS NULL AND "future_period" IS NULL AND "ssp" IS NULL AND "gcm" IS NULL AND "scenario_label" IS NULL) OR ("role" IN ('future_primary', 'future_secondary') AND "baseline_collection_id" IS NOT NULL AND "baseline_manifest_sha256" IS NOT NULL AND "future_period" IS NOT NULL AND length(btrim("future_period")) > 0 AND "ssp" IS NOT NULL AND length(btrim("ssp")) > 0 AND "scenario_label" IS NOT NULL AND length(btrim("scenario_label")) > 0)));

--> statement-breakpoint
CREATE OR REPLACE FUNCTION sdm_climate_collection_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	member_keys text[];
	member_ordinals integer[];
	members_valid boolean;
	expected_distinct integer;
	baseline_row climate_collections%ROWTYPE;
	parent_count integer;
	parent_gcm_count integer;
	parents_valid boolean;
	expected_manifest jsonb;
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'climate collection tombstones cannot be deleted';
	END IF;
	IF TG_OP = 'INSERT' THEN
		IF NEW."state" <> 'staging' THEN RAISE EXCEPTION 'climate collections must begin in staging'; END IF;
		RETURN NEW;
	END IF;

	IF OLD."state" <> 'staging' AND
		(to_jsonb(NEW) - ARRAY['state','updated_at','quarantined_at','quarantine_reason','deleted_at','deletion_receipt']::text[])
		IS DISTINCT FROM
		(to_jsonb(OLD) - ARRAY['state','updated_at','quarantined_at','quarantine_reason','deleted_at','deletion_receipt']::text[]) THEN
		RAISE EXCEPTION 'published climate collection identity is immutable';
	END IF;

	IF (OLD."state" = 'staging' AND NEW."state" NOT IN ('staging', 'ready', 'quarantined'))
		OR (OLD."state" = 'ready' AND NEW."state" NOT IN ('ready', 'quarantined'))
		OR (OLD."state" = 'quarantined' AND NEW."state" NOT IN ('quarantined', 'deleted'))
		OR (OLD."state" = 'deleted' AND NEW."state" <> 'deleted') THEN
		RAISE EXCEPTION 'invalid climate collection lifecycle transition';
	END IF;

	IF OLD."state" = 'staging' AND NEW."state" = 'ready' THEN
		IF (to_jsonb(NEW) - ARRAY['state','manifest_schema_version','manifest_sha256','manifest','published_by_user_id','published_at','updated_at']::text[])
			IS DISTINCT FROM
			(to_jsonb(OLD) - ARRAY['state','manifest_schema_version','manifest_sha256','manifest','published_by_user_id','published_at','updated_at']::text[]) THEN
			RAISE EXCEPTION 'climate collection identity cannot change during publication';
		END IF;
		IF OLD."validation_state" <> 'valid' OR OLD."validation_report_sha256" IS NULL
			OR OLD."validator_identity" IS NULL OR OLD."validated_at" IS NULL THEN
			RAISE EXCEPTION 'climate collection must be validated before publication';
		END IF;
		SELECT count(DISTINCT key) INTO expected_distinct FROM unnest(NEW."expected_variable_keys") AS key;
		IF expected_distinct <> cardinality(NEW."expected_variable_keys") THEN
			RAISE EXCEPTION 'expected climate variables must be unique';
		END IF;

		PERFORM a."id"
		FROM "climate_collection_members" m
		JOIN "input_assets" a ON a."id" = m."asset_id"
		WHERE m."collection_id" = NEW."id"
		ORDER BY a."id"
		FOR SHARE OF a;

		SELECT array_agg(m."variable_key"::text ORDER BY m."ordinal"),
			array_agg(m."ordinal" ORDER BY m."ordinal"),
			bool_and(m."state" = 'validated'
				AND m."grid_fingerprint" = NEW."grid_fingerprint"
				AND a."scope" = 'system'
				AND a."kind" = 'climate_raster'
				AND a."state" = 'ready'
				AND a."content_sha256" = m."sha256"
				AND a."content_size" = m."byte_size"
				AND v."active")
		INTO member_keys, member_ordinals, members_valid
		FROM "climate_collection_members" m
		JOIN "input_assets" a ON a."id" = m."asset_id"
		JOIN "climate_variable_catalog" v ON v."variable_key" = m."variable_key"
		WHERE m."collection_id" = NEW."id";
		IF member_keys IS DISTINCT FROM NEW."expected_variable_keys"
			OR member_ordinals IS DISTINCT FROM ARRAY(SELECT generate_series(1, cardinality(NEW."expected_variable_keys")))
			OR members_valid IS DISTINCT FROM true THEN
			RAISE EXCEPTION 'climate collection members are incomplete or invalid';
		END IF;

		IF NEW."kind" IN ('future_scenario', 'derived_future') THEN
			SELECT * INTO baseline_row FROM "climate_collections"
			WHERE "id" = NEW."baseline_collection_id" FOR SHARE;
			IF NOT FOUND OR baseline_row."state" <> 'ready' OR baseline_row."kind" <> 'current_baseline'
				OR baseline_row."grid_fingerprint" <> NEW."grid_fingerprint"
				OR baseline_row."expected_variable_keys" <> NEW."expected_variable_keys" THEN
				RAISE EXCEPTION 'future climate baseline is incompatible';
			END IF;
			IF EXISTS (
				SELECT 1
				FROM "climate_collection_members" fm
				JOIN "climate_collection_members" bm
					ON bm."collection_id" = NEW."baseline_collection_id" AND bm."variable_key" = fm."variable_key"
				WHERE fm."collection_id" = NEW."id" AND (
					fm."units" IS DISTINCT FROM bm."units"
					OR fm."datatype" IS DISTINCT FROM bm."datatype"
					OR fm."scale_factor" IS DISTINCT FROM bm."scale_factor"
					OR fm."add_offset" IS DISTINCT FROM bm."add_offset"
					OR fm."nodata_semantics" IS DISTINCT FROM bm."nodata_semantics"
				)
			) THEN
				RAISE EXCEPTION 'future climate variable semantics are incompatible with the baseline';
			END IF;
		END IF;

		PERFORM pc."id"
		FROM "climate_collection_parents" p
		JOIN "climate_collections" pc ON pc."id" = p."parent_collection_id"
		WHERE p."child_collection_id" = NEW."id"
		ORDER BY pc."id"
		FOR SHARE OF pc;

		SELECT count(*), count(DISTINCT pc."gcm"), bool_and(p."parent_ordinal" > 0
			AND pc."state" = 'ready'
			AND pc."kind" = 'future_scenario'
			AND pc."manifest_sha256" = p."parent_manifest_sha256"
			AND pc."grid_fingerprint" = NEW."grid_fingerprint"
			AND pc."expected_variable_keys" = NEW."expected_variable_keys"
			AND pc."future_period" = NEW."future_period"
			AND pc."ssp" = NEW."ssp"
			AND pc."baseline_collection_id" = NEW."baseline_collection_id")
		INTO parent_count, parent_gcm_count, parents_valid
		FROM "climate_collection_parents" p
		JOIN "climate_collections" pc ON pc."id" = p."parent_collection_id"
		WHERE p."child_collection_id" = NEW."id";
		IF NEW."kind" = 'derived_future' THEN
			IF parent_count = 0 OR parents_valid IS DISTINCT FROM true OR
				(SELECT array_agg("parent_ordinal" ORDER BY "parent_ordinal") FROM "climate_collection_parents" WHERE "child_collection_id" = NEW."id")
				<> ARRAY(SELECT generate_series(1, parent_count)) THEN
				RAISE EXCEPTION 'derived climate parents are incomplete or invalid';
			END IF;
			IF NEW."derivation_algorithm_id" = 'multi_gcm_average' AND (parent_count < 2 OR parent_gcm_count < 2) THEN
				RAISE EXCEPTION 'multi-GCM derivation requires at least two distinct GCM parents';
			END IF;
			IF EXISTS (
				SELECT 1
				FROM "climate_collection_members" child_member
				JOIN "climate_collection_parents" parent_link ON parent_link."child_collection_id" = NEW."id"
				JOIN "climate_collection_members" parent_member
					ON parent_member."collection_id" = parent_link."parent_collection_id"
					AND parent_member."asset_id" = child_member."asset_id"
				WHERE child_member."collection_id" = NEW."id"
			) THEN
				RAISE EXCEPTION 'derived climate collections require distinct output assets';
			END IF;
		ELSIF parent_count <> 0 THEN
			RAISE EXCEPTION 'non-derived climate collections cannot have parents';
		END IF;

		expected_manifest := sdm_build_climate_manifest(NEW."id", NEW."manifest_schema_version");
		IF NEW."manifest" IS DISTINCT FROM expected_manifest THEN
			RAISE EXCEPTION 'climate collection manifest does not match canonical collection data';
		END IF;
		IF NEW."manifest_sha256" IS DISTINCT FROM encode(digest(convert_to(expected_manifest::text, 'UTF8'), 'sha256'), 'hex') THEN
			RAISE EXCEPTION 'climate collection manifest hash is invalid';
		END IF;
	END IF;

	IF NEW."state" = 'deleted' THEN
		IF EXISTS (SELECT 1 FROM "climate_run_bindings" WHERE "collection_id" = NEW."id" OR "baseline_collection_id" = NEW."id") THEN
			RAISE EXCEPTION 'referenced climate collections cannot be deleted';
		END IF;
		IF EXISTS (SELECT 1 FROM "climate_collection_members" WHERE "collection_id" = NEW."id" AND "state" <> 'deleted') THEN
			RAISE EXCEPTION 'climate collection members must be deleted first';
		END IF;
	END IF;
	IF NEW."state" IN ('quarantined', 'deleted') AND OLD."state" <> NEW."state" THEN
		IF EXISTS (
			SELECT 1 FROM "climate_collections" dependent
			WHERE dependent."baseline_collection_id" = NEW."id" AND dependent."state" = 'ready'
		) OR EXISTS (
			SELECT 1
			FROM "climate_collection_parents" p
			JOIN "climate_collections" dependent ON dependent."id" = p."child_collection_id"
			WHERE p."parent_collection_id" = NEW."id" AND dependent."state" = 'ready'
		) THEN
			RAISE EXCEPTION 'dependent climate collections must be quarantined first';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION sdm_climate_member_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	collection_state climate_collection_state;
	asset_row input_assets%ROWTYPE;
BEGIN
	IF TG_OP = 'UPDATE' AND NEW."collection_id" IS DISTINCT FROM OLD."collection_id" THEN
		RAISE EXCEPTION 'climate members cannot move between collections';
	END IF;
	SELECT "state" INTO collection_state
	FROM "climate_collections"
	WHERE "id" = COALESCE(NEW."collection_id", OLD."collection_id")
	FOR UPDATE;

	IF collection_state IS NULL THEN
		RAISE EXCEPTION 'climate collection is unavailable';
	END IF;

	IF TG_OP = 'DELETE' THEN
		IF collection_state <> 'staging' THEN
			RAISE EXCEPTION 'published climate members cannot be deleted';
		END IF;
		RETURN OLD;
	END IF;

	IF collection_state <> 'staging' THEN
		IF TG_OP <> 'UPDATE' OR collection_state <> 'quarantined' THEN
			RAISE EXCEPTION 'published climate members are immutable';
		END IF;
		IF (to_jsonb(NEW) - ARRAY['state','quarantined_at','deleted_at']::text[])
			IS DISTINCT FROM
			(to_jsonb(OLD) - ARRAY['state','quarantined_at','deleted_at']::text[]) THEN
			RAISE EXCEPTION 'climate member identity is immutable';
		END IF;
		IF OLD."state" = 'deleted' OR NEW."state" NOT IN ('quarantined', 'deleted') THEN
			RAISE EXCEPTION 'invalid climate member lifecycle transition';
		END IF;
		RETURN NEW;
	END IF;

	SELECT * INTO asset_row FROM "input_assets" WHERE "id" = NEW."asset_id" FOR SHARE;
	IF NOT FOUND
		OR asset_row."scope" <> 'system'
		OR asset_row."kind" <> 'climate_raster'
		OR asset_row."state" <> 'ready'
		OR asset_row."content_sha256" IS NULL
		OR asset_row."content_size" IS NULL
		OR asset_row."content_sha256" <> NEW."sha256"
		OR asset_row."content_size" <> NEW."byte_size" THEN
		RAISE EXCEPTION 'climate member asset identity is invalid';
	END IF;
	RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION sdm_climate_parent_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	child_state climate_collection_state;
	parent_state climate_collection_state;
	parent_hash varchar(64);
	has_cycle boolean;
BEGIN
	IF TG_OP = 'UPDATE' AND NEW."child_collection_id" IS DISTINCT FROM OLD."child_collection_id" THEN
		RAISE EXCEPTION 'climate lineage cannot move between collections';
	END IF;
	SELECT "state" INTO child_state
	FROM "climate_collections"
	WHERE "id" = COALESCE(NEW."child_collection_id", OLD."child_collection_id")
	FOR UPDATE;
	IF child_state IS NULL OR child_state <> 'staging' THEN
		RAISE EXCEPTION 'climate collection lineage is immutable after staging';
	END IF;
	IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

	SELECT "state", "manifest_sha256" INTO parent_state, parent_hash
	FROM "climate_collections"
	WHERE "id" = NEW."parent_collection_id"
	FOR SHARE;
	IF parent_state IS DISTINCT FROM 'ready' OR parent_hash IS DISTINCT FROM NEW."parent_manifest_sha256" THEN
		RAISE EXCEPTION 'derived climate parent is not ready with the expected manifest';
	END IF;

	WITH RECURSIVE ancestors("id") AS (
		SELECT NEW."parent_collection_id"
		UNION
		SELECT p."parent_collection_id"
		FROM "climate_collection_parents" p
		JOIN ancestors a ON p."child_collection_id" = a."id"
	)
	SELECT EXISTS (SELECT 1 FROM ancestors WHERE "id" = NEW."child_collection_id") INTO has_cycle;
	IF has_cycle THEN RAISE EXCEPTION 'climate collection lineage cycle'; END IF;
	RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION sdm_climate_asset_lifecycle_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD."kind" = 'climate_raster' AND OLD."state" = 'ready' AND NEW."state" <> 'ready' THEN
		IF EXISTS (
			SELECT 1
			FROM "climate_collection_members" m
			JOIN "climate_collections" c ON c."id" = m."collection_id"
			WHERE m."asset_id" = OLD."id" AND c."state" = 'ready'
		) THEN
			RAISE EXCEPTION 'ready climate collection members cannot be invalidated';
		END IF;
		IF EXISTS (
			SELECT 1
			FROM "climate_collection_members" m
			JOIN "climate_run_bindings" b ON b."collection_id" = m."collection_id" OR b."baseline_collection_id" = m."collection_id"
			WHERE m."asset_id" = OLD."id"
		) THEN
			RAISE EXCEPTION 'run-bound climate bytes must be retained';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION sdm_climate_binding_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	collection_row climate_collections%ROWTYPE;
	baseline_row climate_collections%ROWTYPE;
	selected_keys text[];
	selected_distinct integer;
	current_binding climate_run_bindings%ROWTYPE;
	run_mode climate_input_mode;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		RAISE EXCEPTION 'climate run bindings are immutable';
	END IF;
	SELECT "climate_input_mode" INTO run_mode FROM "runs" WHERE "id" = NEW."run_id" FOR UPDATE;
	IF run_mode IS DISTINCT FROM 'canonical' THEN RAISE EXCEPTION 'run is not in canonical climate mode'; END IF;

	SELECT * INTO collection_row FROM "climate_collections" WHERE "id" = NEW."collection_id" FOR SHARE;
	IF NOT FOUND OR collection_row."state" <> 'ready'
		OR collection_row."manifest_sha256" <> NEW."manifest_sha256"
		OR collection_row."manifest_schema_version" <> NEW."manifest_schema_version"
		OR collection_row."grid_fingerprint" <> NEW."grid_fingerprint" THEN
		RAISE EXCEPTION 'climate collection binding identity is invalid';
	END IF;
	SELECT count(DISTINCT key) INTO selected_distinct FROM unnest(NEW."ordered_variable_keys") AS key;
	SELECT array_agg("variable_key"::text ORDER BY "ordinal") INTO selected_keys
	FROM "climate_collection_members"
	WHERE "collection_id" = NEW."collection_id" AND "variable_key" = ANY(NEW."ordered_variable_keys");
	IF selected_distinct <> cardinality(NEW."ordered_variable_keys") OR selected_keys IS DISTINCT FROM NEW."ordered_variable_keys" THEN
		RAISE EXCEPTION 'climate binding variable order is invalid';
	END IF;

	IF NEW."role" = 'current' THEN
		IF collection_row."kind" <> 'current_baseline'
			OR NEW."baseline_period" <> collection_row."baseline_start" || '/' || collection_row."baseline_end" THEN
			RAISE EXCEPTION 'current climate binding metadata is invalid';
		END IF;
	ELSE
		IF collection_row."kind" NOT IN ('future_scenario', 'derived_future')
			OR NEW."baseline_collection_id" <> collection_row."baseline_collection_id"
			OR NEW."future_period" IS DISTINCT FROM collection_row."future_period"
			OR NEW."ssp" IS DISTINCT FROM collection_row."ssp"
			OR NEW."gcm" IS DISTINCT FROM collection_row."gcm"
			OR NEW."scenario_label" IS DISTINCT FROM collection_row."scenario_label" THEN
			RAISE EXCEPTION 'future climate binding metadata is invalid';
		END IF;
		SELECT * INTO baseline_row FROM "climate_collections"
		WHERE "id" = NEW."baseline_collection_id" FOR SHARE;
		IF NOT FOUND OR baseline_row."state" <> 'ready'
			OR baseline_row."kind" <> 'current_baseline'
			OR baseline_row."manifest_sha256" <> NEW."baseline_manifest_sha256" THEN
			RAISE EXCEPTION 'future climate binding baseline is unavailable';
		END IF;
		SELECT * INTO current_binding FROM "climate_run_bindings"
		WHERE "run_id" = NEW."run_id" AND "role" = 'current' FOR SHARE;
		IF NOT FOUND
			OR current_binding."collection_id" <> NEW."baseline_collection_id"
			OR current_binding."manifest_sha256" <> NEW."baseline_manifest_sha256"
			OR current_binding."grid_fingerprint" <> NEW."grid_fingerprint"
			OR current_binding."ordered_variable_keys" <> NEW."ordered_variable_keys"
			OR current_binding."baseline_period" <> NEW."baseline_period" THEN
			RAISE EXCEPTION 'future climate binding is incompatible with its current baseline';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION sdm_canonical_run_binding_required()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."climate_input_mode" = 'canonical' AND NOT EXISTS (
		SELECT 1 FROM "climate_run_bindings" WHERE "run_id" = NEW."id" AND "role" = 'current'
	) THEN
		RAISE EXCEPTION 'canonical run requires a current climate binding';
	END IF;
	RETURN NULL;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION sdm_canonical_run_mode_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD."climate_input_mode" = 'canonical' AND NEW."climate_input_mode" <> 'canonical' THEN
		RAISE EXCEPTION 'canonical run climate mode is immutable';
	END IF;
	RETURN NEW;
END;
$$;
