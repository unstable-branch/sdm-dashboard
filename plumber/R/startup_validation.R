sdm_production_secret_issues <- function(
  node_env = Sys.getenv("NODE_ENV", ""),
  internal_key = Sys.getenv("PLUMBER_INTERNAL_KEY", ""),
  execution_key = Sys.getenv("PLUMBER_EXECUTION_KEY", ""),
  data_encryption_key = Sys.getenv("DATA_ENCRYPTION_KEY", "")
) {
  if (!identical(node_env, "production")) return(character(0))

  issues <- character(0)
  if (!nzchar(internal_key) || nchar(internal_key) < 32L) {
    issues <- c(issues, "PLUMBER_INTERNAL_KEY (>=32 chars)")
  }
  if (!nzchar(execution_key) || nchar(execution_key) < 32L) {
    issues <- c(issues, "PLUMBER_EXECUTION_KEY (>=32 chars)")
  }
  if (!nzchar(data_encryption_key) || nchar(data_encryption_key) < 32L) {
    issues <- c(issues, "DATA_ENCRYPTION_KEY (>=32 chars)")
  }
  if (nzchar(internal_key) && nzchar(execution_key) && identical(internal_key, execution_key)) {
    issues <- c(issues, "PLUMBER_EXECUTION_KEY must be independent from PLUMBER_INTERNAL_KEY")
  }
  issues
}
