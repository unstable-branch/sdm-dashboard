import { assertEnvironmentDisposableTarget } from "./disposable-execution-postgres.js";

// Imported first by destructive real-DB suites, before DB clients/hooks are loaded.
if (process.env.SDM_MIGRATION_TEST_DATABASE_URL) assertEnvironmentDisposableTarget("SDM_MIGRATION_TEST");
if (process.env.SDM_EXECUTION_TEST_DATABASE_URL) assertEnvironmentDisposableTarget("SDM_EXECUTION_TEST");
