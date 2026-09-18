import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const expectedDatabase = process.env.SDM_CLIMATE_TEST_DATABASE;
if (!expectedDatabase || !expectedDatabase.endsWith("_climate_test")) {
  throw new Error("SDM_CLIMATE_TEST_DATABASE must name a dedicated *_climate_test database because this verifier leaves disposable fixtures");
}

type Fixture = { userId: string; assetId: string; collectionId: string };
type DerivedFixture = { child: Fixture; parentCollectionId: string };

async function createFixture(client: pg.Client, label: string): Promise<Fixture> {
  const userId = randomUUID();
  const assetId = randomUUID();
  const collectionId = randomUUID();
  await client.query(
    `INSERT INTO users (id, email, password_hash, role, storage_quota_bytes)
     VALUES ($1, $2, 'synthetic', 'admin', NULL)`,
    [userId, `climate-race-${label}-${userId}@example.invalid`],
  );
  await client.query(
    `INSERT INTO input_assets (
       id, creator_user_id, scope, kind, storage_locator, state, content_sha256, content_size
     ) VALUES ($1, $2, 'system', 'climate_raster', $3, 'ready', repeat('a', 64), 101)`,
    [assetId, userId, `climate/race-${label}-${assetId}.tif`],
  );
  await client.query(
    `INSERT INTO climate_collections (
       id, kind, created_by_user_id, provider, dataset, dataset_version, licence, attribution,
       source_evidence, expected_variable_keys, grid_fingerprint, grid_definition,
       baseline_start, baseline_end, validation_state, validation_report_sha256,
       validator_identity, validated_at
     ) VALUES (
       $1, 'current_baseline', $2, 'Synthetic', 'Race fixture', '1', 'CC0',
       'Synthetic concurrency fixture', '{}', ARRAY['bio01'], repeat('1', 64), '{}',
       '1981', '2010', 'valid', repeat('e', 64), 'synthetic-validator/1', now()
     )`,
    [collectionId, userId],
  );
  await client.query(
    `INSERT INTO climate_collection_members (
       collection_id, asset_id, ordinal, variable_key, state, media_kind, byte_size, sha256,
       units, datatype, nodata_semantics, grid_fingerprint, validation_evidence, validated_at
     ) VALUES (
       $1, $2, 1, 'bio01', 'validated', 'image/tiff', 101, repeat('a', 64),
       'degC', 'float32', '{"kind":"nan"}', repeat('1', 64), '{}', now()
     )`,
    [collectionId, assetId],
  );
  return { userId, assetId, collectionId };
}

async function publish(client: pg.Client, fixture: Fixture): Promise<void> {
  await client.query(
    `UPDATE climate_collections SET
       state = 'ready', manifest_schema_version = 1,
       manifest = sdm_build_climate_manifest(id, 1),
       manifest_sha256 = encode(digest(convert_to(sdm_build_climate_manifest(id, 1)::text, 'UTF8'), 'sha256'), 'hex'),
       published_by_user_id = $2, published_at = now()
     WHERE id = $1`,
    [fixture.collectionId, fixture.userId],
  );
}

async function createDerivedFixture(client: pg.Client, label: string): Promise<DerivedFixture> {
  const baseline = await createFixture(client, `${label}-baseline`);
  await publish(client, baseline);

  const parentAssetId = randomUUID();
  const parentCollectionId = randomUUID();
  await client.query(
    `INSERT INTO input_assets (
       id, creator_user_id, scope, kind, storage_locator, state, content_sha256, content_size
     ) VALUES ($1, $2, 'system', 'climate_raster', $3, 'ready', repeat('b', 64), 201)`,
    [parentAssetId, baseline.userId, `climate/race-${label}-parent-${parentAssetId}.tif`],
  );
  await client.query(
    `INSERT INTO climate_collections (
       id, kind, created_by_user_id, provider, dataset, dataset_version, licence, attribution,
       source_evidence, expected_variable_keys, grid_fingerprint, grid_definition,
       future_period, ssp, gcm, scenario_label, baseline_collection_id,
       validation_state, validation_report_sha256, validator_identity, validated_at
     ) VALUES (
       $1, 'future_scenario', $2, 'Synthetic', 'Race parent', '1', 'CC0',
       'Synthetic concurrency fixture', '{}', ARRAY['bio01'], repeat('1', 64), '{}',
       '2041-2060', 'SSP2-4.5', 'Synthetic-GCM', 'Synthetic future', $3,
       'valid', repeat('e', 64), 'synthetic-validator/1', now()
     )`,
    [parentCollectionId, baseline.userId, baseline.collectionId],
  );
  await client.query(
    `INSERT INTO climate_collection_members (
       collection_id, asset_id, ordinal, variable_key, state, media_kind, byte_size, sha256,
       units, datatype, nodata_semantics, grid_fingerprint, validation_evidence, validated_at
     ) VALUES (
       $1, $2, 1, 'bio01', 'validated', 'image/tiff', 201, repeat('b', 64),
       'degC', 'float32', '{"kind":"nan"}', repeat('1', 64), '{}', now()
     )`,
    [parentCollectionId, parentAssetId],
  );
  await publish(client, { userId: baseline.userId, assetId: parentAssetId, collectionId: parentCollectionId });

  const childAssetId = randomUUID();
  const childCollectionId = randomUUID();
  await client.query(
    `INSERT INTO input_assets (
       id, creator_user_id, scope, kind, storage_locator, state, content_sha256, content_size
     ) VALUES ($1, $2, 'system', 'climate_raster', $3, 'ready', repeat('c', 64), 301)`,
    [childAssetId, baseline.userId, `climate/race-${label}-child-${childAssetId}.tif`],
  );
  await client.query(
    `INSERT INTO climate_collections (
       id, kind, created_by_user_id, provider, dataset, dataset_version, licence, attribution,
       source_evidence, expected_variable_keys, grid_fingerprint, grid_definition,
       future_period, ssp, scenario_label, baseline_collection_id,
       derivation_algorithm_id, derivation_algorithm_version, derivation_parameters,
       missing_cell_policy, derivation_software_identity,
       validation_state, validation_report_sha256, validator_identity, validated_at
     ) VALUES (
       $1, 'derived_future', $2, 'Synthetic', 'Race child', '1', 'CC0',
       'Synthetic concurrency fixture', '{}', ARRAY['bio01'], repeat('1', 64), '{}',
       '2041-2060', 'SSP2-4.5', 'Synthetic derived', $3,
       'grid_transform', '1', '{}', 'require_all_parents', '{}',
       'valid', repeat('e', 64), 'synthetic-validator/1', now()
     )`,
    [childCollectionId, baseline.userId, baseline.collectionId],
  );
  await client.query(
    `INSERT INTO climate_collection_parents (
       child_collection_id, parent_ordinal, parent_collection_id, parent_manifest_sha256
     ) SELECT $1, 1, id, manifest_sha256 FROM climate_collections WHERE id = $2`,
    [childCollectionId, parentCollectionId],
  );
  await client.query(
    `INSERT INTO climate_collection_members (
       collection_id, asset_id, ordinal, variable_key, state, media_kind, byte_size, sha256,
       units, datatype, nodata_semantics, grid_fingerprint, validation_evidence, validated_at
     ) VALUES (
       $1, $2, 1, 'bio01', 'validated', 'image/tiff', 301, repeat('c', 64),
       'degC', 'float32', '{"kind":"nan"}', repeat('1', 64), '{}', now()
     )`,
    [childCollectionId, childAssetId],
  );
  return {
    child: { userId: baseline.userId, assetId: childAssetId, collectionId: childCollectionId },
    parentCollectionId,
  };
}

async function waitForBlocker(observer: pg.Client, waitingPid: number, blockerPid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await observer.query<{ blockers: number[] }>(
      "SELECT pg_blocking_pids($1)::int[] AS blockers",
      [waitingPid],
    );
    if (result.rows[0]?.blockers.includes(blockerPid)) return;
  }
  throw new Error(`backend ${waitingPid} did not block on ${blockerPid}`);
}

async function expectRejected(operation: Promise<unknown>, expected: RegExp): Promise<void> {
  try {
    await operation;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (expected.test(message)) return;
    throw error;
  }
  throw new Error(`operation unexpectedly succeeded; expected ${expected}`);
}

const setup = new Client({ connectionString });
const publisher = new Client({ connectionString });
const invalidator = new Client({ connectionString });
const observer = new Client({ connectionString });
const clients = [setup, publisher, invalidator, observer];
const connected: pg.Client[] = [];

try {
  for (const client of clients) {
    await client.connect();
    connected.push(client);
  }
  const databaseResult = await setup.query<{ name: string }>("SELECT current_database() AS name");
  const actualDatabase = databaseResult.rows[0]?.name;
  if (actualDatabase !== expectedDatabase) {
    throw new Error(`refusing to write climate concurrency fixtures to ${actualDatabase || "an unknown database"}; expected ${expectedDatabase}`);
  }
  await publisher.query("SET statement_timeout = '10s'; SET lock_timeout = '5s'");
  await invalidator.query("SET statement_timeout = '10s'; SET lock_timeout = '5s'");

  const publishFirst = await createFixture(setup, "publish-first");
  await publisher.query("BEGIN");
  await publish(publisher, publishFirst);
  await invalidator.query("BEGIN");
  const invalidation = invalidator.query(
    "UPDATE input_assets SET state = 'quarantined', quarantined_at = now() WHERE id = $1",
    [publishFirst.assetId],
  );
  await waitForBlocker(observer, invalidator.processID!, publisher.processID!);
  await publisher.query("COMMIT");
  await expectRejected(invalidation, /ready climate collection members cannot be invalidated/);
  await invalidator.query("ROLLBACK");

  const invalidateFirst = await createFixture(setup, "invalidate-first");
  await invalidator.query("BEGIN");
  await invalidator.query(
    "UPDATE input_assets SET state = 'quarantined', quarantined_at = now() WHERE id = $1",
    [invalidateFirst.assetId],
  );
  await publisher.query("BEGIN");
  const publication = publish(publisher, invalidateFirst);
  await waitForBlocker(observer, publisher.processID!, invalidator.processID!);
  await invalidator.query("COMMIT");
  await expectRejected(publication, /climate collection members are incomplete or invalid/);
  await publisher.query("ROLLBACK");

  const parentPublishFirst = await createDerivedFixture(setup, "parent-publish-first");
  await publisher.query("BEGIN");
  await publish(publisher, parentPublishFirst.child);
  await invalidator.query("BEGIN");
  const parentQuarantine = invalidator.query(
    `UPDATE climate_collections SET
       state = 'quarantined', quarantined_at = now(), quarantine_reason = 'race verification'
     WHERE id = $1`,
    [parentPublishFirst.parentCollectionId],
  );
  await waitForBlocker(observer, invalidator.processID!, publisher.processID!);
  await publisher.query("COMMIT");
  await expectRejected(parentQuarantine, /dependent climate collections must be quarantined first/);
  await invalidator.query("ROLLBACK");

  const parentInvalidateFirst = await createDerivedFixture(setup, "parent-invalidate-first");
  await invalidator.query("BEGIN");
  await invalidator.query(
    `UPDATE climate_collections SET
       state = 'quarantined', quarantined_at = now(), quarantine_reason = 'race verification'
     WHERE id = $1`,
    [parentInvalidateFirst.parentCollectionId],
  );
  await publisher.query("BEGIN");
  const derivedPublication = publish(publisher, parentInvalidateFirst.child);
  await waitForBlocker(observer, publisher.processID!, invalidator.processID!);
  await invalidator.query("COMMIT");
  await expectRejected(derivedPublication, /derived climate parents are incomplete or invalid/);
  await publisher.query("ROLLBACK");

  console.log("climate asset and parent lifecycle races serialize safely");
} finally {
  if (connected.includes(observer)) {
    await Promise.allSettled([
      publisher.processID ? observer.query("SELECT pg_cancel_backend($1)", [publisher.processID]) : Promise.resolve(),
      invalidator.processID ? observer.query("SELECT pg_cancel_backend($1)", [invalidator.processID]) : Promise.resolve(),
    ]);
  }
  await Promise.allSettled([
    connected.includes(publisher) ? publisher.query("ROLLBACK") : Promise.resolve(),
    connected.includes(invalidator) ? invalidator.query("ROLLBACK") : Promise.resolve(),
  ]);
  await Promise.allSettled(connected.map((client) => client.end()));
}
