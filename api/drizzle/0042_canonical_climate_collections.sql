-- Canonical climate collection foundation. Historical run configuration is
-- deliberately retained as legacy_unverified and is never auto-adopted.
--
-- Safe rollback is application-only: deploy the predecessor while retaining
-- these additive database objects. Existing and newly-created runs default to
-- legacy_unverified until the canonical API cutover lands, so the predecessor
-- ignores this schema. Do not remove the climate_raster enum value or rewrite
-- the migration journal. A later destructive database reversal would require a
-- separately reviewed export/retention plan for canonical evidence. pgcrypto
-- may be shared and must never be dropped blindly.

CREATE TYPE "public"."climate_binding_role" AS ENUM('current', 'future_primary', 'future_secondary');--> statement-breakpoint
CREATE TYPE "public"."climate_collection_kind" AS ENUM('current_baseline', 'future_scenario', 'derived_future');--> statement-breakpoint
CREATE TYPE "public"."climate_collection_state" AS ENUM('staging', 'ready', 'quarantined', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."climate_input_mode" AS ENUM('legacy_unverified', 'canonical');--> statement-breakpoint
CREATE TYPE "public"."climate_member_state" AS ENUM('staging', 'validated', 'quarantined', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."climate_validation_state" AS ENUM('pending', 'valid', 'invalid');--> statement-breakpoint
ALTER TYPE "public"."input_asset_kind" ADD VALUE 'climate_raster';--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "climate_collection_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"variable_key" varchar(64) NOT NULL,
	"state" "climate_member_state" DEFAULT 'staging' NOT NULL,
	"media_kind" varchar(32) NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"units" text NOT NULL,
	"datatype" text NOT NULL,
	"scale_factor" double precision DEFAULT 1 NOT NULL,
	"add_offset" double precision DEFAULT 0 NOT NULL,
	"nodata_semantics" jsonb NOT NULL,
	"grid_fingerprint" varchar(64) NOT NULL,
	"validation_evidence" jsonb,
	"validated_at" timestamp with time zone,
	"quarantined_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "climate_collection_members_ordinal_ck" CHECK ("ordinal" > 0),
	CONSTRAINT "climate_collection_members_size_ck" CHECK ("byte_size" >= 0),
	CONSTRAINT "climate_collection_members_hash_ck" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "climate_collection_members_grid_hash_ck" CHECK ("grid_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "climate_collection_members_media_ck" CHECK ("media_kind" = 'image/tiff'),
	CONSTRAINT "climate_collection_members_text_ck" CHECK (length(btrim("units")) > 0 AND length(btrim("datatype")) > 0),
	CONSTRAINT "climate_collection_members_nodata_ck" CHECK (jsonb_typeof("nodata_semantics") = 'object'),
	CONSTRAINT "climate_collection_members_validated_ck" CHECK ("state" <> 'validated' OR ("validation_evidence" IS NOT NULL AND "validated_at" IS NOT NULL)),
	CONSTRAINT "climate_collection_members_quarantine_ck" CHECK ("state" <> 'quarantined' OR "quarantined_at" IS NOT NULL),
	CONSTRAINT "climate_collection_members_deleted_ck" CHECK ("state" <> 'deleted' OR "deleted_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "climate_collection_parents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"child_collection_id" uuid NOT NULL,
	"parent_ordinal" integer NOT NULL,
	"parent_collection_id" uuid NOT NULL,
	"parent_manifest_sha256" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "climate_collection_parents_ordinal_ck" CHECK ("parent_ordinal" > 0),
	CONSTRAINT "climate_collection_parents_distinct_ck" CHECK ("child_collection_id" <> "parent_collection_id"),
	CONSTRAINT "climate_collection_parents_hash_ck" CHECK ("parent_manifest_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "climate_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "climate_collection_kind" NOT NULL,
	"state" "climate_collection_state" DEFAULT 'staging' NOT NULL,
	"validation_state" "climate_validation_state" DEFAULT 'pending' NOT NULL,
	"created_by_user_id" uuid,
	"published_by_user_id" uuid,
	"provider" text NOT NULL,
	"dataset" text NOT NULL,
	"dataset_version" text NOT NULL,
	"licence" text NOT NULL,
	"attribution" text NOT NULL,
	"source_evidence" jsonb NOT NULL,
	"expected_variable_keys" text[] NOT NULL,
	"grid_fingerprint" varchar(64) NOT NULL,
	"grid_definition" jsonb NOT NULL,
	"baseline_start" varchar(32),
	"baseline_end" varchar(32),
	"future_period" varchar(64),
	"ssp" varchar(64),
	"gcm" varchar(128),
	"scenario_label" text,
	"baseline_collection_id" uuid,
	"derivation_algorithm_id" text,
	"derivation_algorithm_version" text,
	"derivation_parameters" jsonb,
	"missing_cell_policy" text,
	"derivation_software_identity" jsonb,
	"validation_report_sha256" varchar(64),
	"validator_identity" text,
	"validated_at" timestamp with time zone,
	"manifest_schema_version" integer,
	"manifest_sha256" varchar(64),
	"manifest" jsonb,
	"published_at" timestamp with time zone,
	"quarantined_at" timestamp with time zone,
	"quarantine_reason" text,
	"deleted_at" timestamp with time zone,
	"deletion_receipt" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "climate_collections_text_ck" CHECK (length(btrim("provider")) > 0 AND length(btrim("dataset")) > 0 AND length(btrim("dataset_version")) > 0 AND length(btrim("licence")) > 0 AND length(btrim("attribution")) > 0),
	CONSTRAINT "climate_collections_source_ck" CHECK (jsonb_typeof("source_evidence") = 'object'),
	CONSTRAINT "climate_collections_variables_ck" CHECK (cardinality("expected_variable_keys") > 0),
	CONSTRAINT "climate_collections_grid_hash_ck" CHECK ("grid_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "climate_collections_grid_ck" CHECK (jsonb_typeof("grid_definition") = 'object'),
	CONSTRAINT "climate_collections_validation_hash_ck" CHECK ("validation_report_sha256" IS NULL OR "validation_report_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "climate_collections_manifest_hash_ck" CHECK ("manifest_sha256" IS NULL OR "manifest_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "climate_collections_manifest_version_ck" CHECK ("manifest_schema_version" IS NULL OR "manifest_schema_version" > 0),
	CONSTRAINT "climate_collections_manifest_json_ck" CHECK ("manifest" IS NULL OR jsonb_typeof("manifest") = 'object'),
	CONSTRAINT "climate_collections_ready_ck" CHECK ("state" <> 'ready' OR ("validation_state" = 'valid' AND "validation_report_sha256" IS NOT NULL AND "validator_identity" IS NOT NULL AND "validated_at" IS NOT NULL AND "manifest_schema_version" IS NOT NULL AND "manifest_sha256" IS NOT NULL AND "manifest" IS NOT NULL AND "published_by_user_id" IS NOT NULL AND "published_at" IS NOT NULL)),
	CONSTRAINT "climate_collections_quarantine_ck" CHECK ("state" <> 'quarantined' OR ("quarantined_at" IS NOT NULL AND length(btrim("quarantine_reason")) > 0)),
	CONSTRAINT "climate_collections_deleted_ck" CHECK ("state" <> 'deleted' OR ("deleted_at" IS NOT NULL AND "deletion_receipt" IS NOT NULL)),
	CONSTRAINT "climate_collections_kind_ck" CHECK (("kind" = 'current_baseline' AND "baseline_start" IS NOT NULL AND "baseline_end" IS NOT NULL AND "future_period" IS NULL AND "ssp" IS NULL AND "baseline_collection_id" IS NULL) OR ("kind" IN ('future_scenario', 'derived_future') AND "future_period" IS NOT NULL AND "ssp" IS NOT NULL AND "scenario_label" IS NOT NULL AND "baseline_collection_id" IS NOT NULL)),
	CONSTRAINT "climate_collections_gcm_ck" CHECK (("kind" = 'future_scenario' AND "gcm" IS NOT NULL) OR "kind" <> 'future_scenario'),
	CONSTRAINT "climate_collections_derivation_ck" CHECK (("kind" = 'derived_future' AND "derivation_algorithm_id" IS NOT NULL AND "derivation_algorithm_version" IS NOT NULL AND "derivation_parameters" IS NOT NULL AND "missing_cell_policy" IS NOT NULL AND "derivation_software_identity" IS NOT NULL) OR ("kind" <> 'derived_future' AND "derivation_algorithm_id" IS NULL AND "derivation_algorithm_version" IS NULL AND "derivation_parameters" IS NULL AND "missing_cell_policy" IS NULL AND "derivation_software_identity" IS NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "climate_run_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"role" "climate_binding_role" NOT NULL,
	"collection_id" uuid NOT NULL,
	"manifest_sha256" varchar(64) NOT NULL,
	"manifest_schema_version" integer NOT NULL,
	"execution_protocol_version" integer NOT NULL,
	"ordered_variable_keys" text[] NOT NULL,
	"grid_fingerprint" varchar(64) NOT NULL,
	"baseline_collection_id" uuid,
	"baseline_manifest_sha256" varchar(64),
	"baseline_period" varchar(64) NOT NULL,
	"future_period" varchar(64),
	"ssp" varchar(64),
	"gcm" varchar(128),
	"scenario_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "climate_run_bindings_manifest_hash_ck" CHECK ("manifest_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "climate_run_bindings_baseline_hash_ck" CHECK ("baseline_manifest_sha256" IS NULL OR "baseline_manifest_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "climate_run_bindings_grid_hash_ck" CHECK ("grid_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "climate_run_bindings_versions_ck" CHECK ("manifest_schema_version" > 0 AND "execution_protocol_version" > 0),
	CONSTRAINT "climate_run_bindings_variables_ck" CHECK (cardinality("ordered_variable_keys") > 0),
	CONSTRAINT "climate_run_bindings_role_ck" CHECK (("role" = 'current' AND "baseline_collection_id" IS NULL AND "baseline_manifest_sha256" IS NULL AND "future_period" IS NULL AND "ssp" IS NULL) OR ("role" IN ('future_primary', 'future_secondary') AND "baseline_collection_id" IS NOT NULL AND "baseline_manifest_sha256" IS NOT NULL AND "future_period" IS NOT NULL AND "ssp" IS NOT NULL AND "scenario_label" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "climate_variable_catalog" (
	"variable_key" varchar(64) PRIMARY KEY NOT NULL,
	"family" varchar(32) NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "climate_variable_catalog_key_ck" CHECK ("variable_key" ~ '^[a-z][a-z0-9_]{1,63}$'),
	CONSTRAINT "climate_variable_catalog_family_ck" CHECK (length(btrim("family")) > 0),
	CONSTRAINT "climate_variable_catalog_name_ck" CHECK (length(btrim("display_name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "climate_input_mode" "climate_input_mode" DEFAULT 'legacy_unverified' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "climate_collection_members" ADD CONSTRAINT "climate_collection_members_collection_id_climate_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."climate_collections"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "climate_collection_members" ADD CONSTRAINT "climate_collection_members_asset_id_input_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."input_assets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "climate_collection_members" ADD CONSTRAINT "climate_collection_members_variable_key_climate_variable_catalog_variable_key_fk" FOREIGN KEY ("variable_key") REFERENCES "public"."climate_variable_catalog"("variable_key") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "climate_collection_parents" ADD CONSTRAINT "climate_collection_parents_child_collection_id_climate_collections_id_fk" FOREIGN KEY ("child_collection_id") REFERENCES "public"."climate_collections"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "climate_collection_parents" ADD CONSTRAINT "climate_collection_parents_parent_collection_id_climate_collections_id_fk" FOREIGN KEY ("parent_collection_id") REFERENCES "public"."climate_collections"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "climate_collections" ADD CONSTRAINT "climate_collections_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "climate_collections" ADD CONSTRAINT "climate_collections_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "climate_collections" ADD CONSTRAINT "climate_collections_baseline_collection_id_climate_collections_id_fk" FOREIGN KEY ("baseline_collection_id") REFERENCES "public"."climate_collections"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "climate_run_bindings" ADD CONSTRAINT "climate_run_bindings_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "climate_run_bindings" ADD CONSTRAINT "climate_run_bindings_collection_id_climate_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."climate_collections"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "climate_run_bindings" ADD CONSTRAINT "climate_run_bindings_baseline_collection_id_climate_collections_id_fk" FOREIGN KEY ("baseline_collection_id") REFERENCES "public"."climate_collections"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "climate_collection_members_ordinal_unique" ON "climate_collection_members" USING btree ("collection_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "climate_collection_members_variable_unique" ON "climate_collection_members" USING btree ("collection_id","variable_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "climate_collection_members_asset_idx" ON "climate_collection_members" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "climate_collection_parents_ordinal_unique" ON "climate_collection_parents" USING btree ("child_collection_id","parent_ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "climate_collection_parents_parent_unique" ON "climate_collection_parents" USING btree ("child_collection_id","parent_collection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "climate_collection_parents_parent_idx" ON "climate_collection_parents" USING btree ("parent_collection_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "climate_collections_manifest_unique" ON "climate_collections" USING btree ("id","manifest_sha256");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "climate_collections_state_idx" ON "climate_collections" USING btree ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "climate_collections_kind_state_idx" ON "climate_collections" USING btree ("kind","state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "climate_collections_baseline_idx" ON "climate_collections" USING btree ("baseline_collection_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "climate_run_bindings_role_unique" ON "climate_run_bindings" USING btree ("run_id","role");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "climate_run_bindings_collection_idx" ON "climate_run_bindings" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "climate_run_bindings_baseline_idx" ON "climate_run_bindings" USING btree ("baseline_collection_id");
--> statement-breakpoint
INSERT INTO "climate_variable_catalog" ("variable_key", "family", "display_name") VALUES
	('bio01', 'bioclim', 'Annual Mean Temperature'),
	('bio02', 'bioclim', 'Mean Diurnal Range'),
	('bio03', 'bioclim', 'Isothermality'),
	('bio04', 'bioclim', 'Temperature Seasonality'),
	('bio05', 'bioclim', 'Maximum Temperature of Warmest Month'),
	('bio06', 'bioclim', 'Minimum Temperature of Coldest Month'),
	('bio07', 'bioclim', 'Temperature Annual Range'),
	('bio08', 'bioclim', 'Mean Temperature of Wettest Quarter'),
	('bio09', 'bioclim', 'Mean Temperature of Driest Quarter'),
	('bio10', 'bioclim', 'Mean Temperature of Warmest Quarter'),
	('bio11', 'bioclim', 'Mean Temperature of Coldest Quarter'),
	('bio12', 'bioclim', 'Annual Precipitation'),
	('bio13', 'bioclim', 'Precipitation of Wettest Month'),
	('bio14', 'bioclim', 'Precipitation of Driest Month'),
	('bio15', 'bioclim', 'Precipitation Seasonality'),
	('bio16', 'bioclim', 'Precipitation of Wettest Quarter'),
	('bio17', 'bioclim', 'Precipitation of Driest Quarter'),
	('bio18', 'bioclim', 'Precipitation of Warmest Quarter'),
	('bio19', 'bioclim', 'Precipitation of Coldest Quarter')
ON CONFLICT ("variable_key") DO NOTHING;
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
CREATE TRIGGER climate_collection_members_guard_trigger
BEFORE INSERT OR UPDATE OR DELETE ON "climate_collection_members"
FOR EACH ROW EXECUTE FUNCTION sdm_climate_member_guard();
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
CREATE TRIGGER climate_collection_parents_guard_trigger
BEFORE INSERT OR UPDATE OR DELETE ON "climate_collection_parents"
FOR EACH ROW EXECUTE FUNCTION sdm_climate_parent_guard();
--> statement-breakpoint
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
CREATE TRIGGER climate_collections_guard_trigger
BEFORE INSERT OR UPDATE OR DELETE ON "climate_collections"
FOR EACH ROW EXECUTE FUNCTION sdm_climate_collection_guard();
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
CREATE TRIGGER input_assets_climate_lifecycle_guard_trigger
BEFORE UPDATE OF "state" ON "input_assets"
FOR EACH ROW EXECUTE FUNCTION sdm_climate_asset_lifecycle_guard();
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
CREATE TRIGGER climate_run_bindings_guard_trigger
BEFORE INSERT OR UPDATE OR DELETE ON "climate_run_bindings"
FOR EACH ROW EXECUTE FUNCTION sdm_climate_binding_guard();
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
CREATE CONSTRAINT TRIGGER runs_canonical_climate_binding_trigger
AFTER INSERT OR UPDATE OF "climate_input_mode" ON "runs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION sdm_canonical_run_binding_required();
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
--> statement-breakpoint
CREATE TRIGGER runs_canonical_climate_mode_guard_trigger
BEFORE UPDATE OF "climate_input_mode" ON "runs"
FOR EACH ROW EXECUTE FUNCTION sdm_canonical_run_mode_guard();
