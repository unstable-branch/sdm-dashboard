# Container-aware available memory (GB)
# Reads cgroup v2 limit first (container), then falls back to /proc/meminfo (host).
sdm_available_ram_gb <- function() {
  override <- Sys.getenv("SDM_CHILD_MAX_VSIZE", NA_character_)
  if (!is.na(override) && nzchar(override)) {
    num <- as.numeric(gsub("[^0-9.]", "", override))
    if (is.finite(num) && num > 0) return(num)
  }
  cgroup_path <- "/sys/fs/cgroup/memory.max"
  if (file.exists(cgroup_path)) {
    val <- tryCatch(readLines(cgroup_path), error = function(e) character(0))
    if (length(val) > 0 && !identical(val, "max")) {
      gb <- as.numeric(val) / (1024^3)
      if (is.finite(gb) && gb > 0) return(gb)
    }
  }
  tryCatch({
    mem_total <- readLines("/proc/meminfo", n = 1)
    kb <- as.numeric(gsub(".*:\\s*(\\d+).*", "\\1", mem_total))
    if (is.finite(kb) && kb > 0) kb / (1024 * 1024) else NA_real_
  }, error = function(e) NA_real_)
}

# Container-aware memory check via terra (with fallback)
# Uses a small test raster to call terra::mem_info() without requiring
# a pre-existing SpatRaster object. Falls back to sdm_available_ram_gb()
# if terra::mem_info() fails.
sdm_mem_info <- function() {
  cgroup_limit <- sdm_available_ram_gb()
  tryCatch({
    test_rast <- terra::rast(ncols = 100, nrows = 100, nl = 1)
    mi <- terra::mem_info(test_rast)
    memavail <- as.numeric(mi)[2]
    if (!is.finite(memavail) || memavail <= 0) {
      memavail <- cgroup_limit
    } else if (is.finite(cgroup_limit) && cgroup_limit > 0) {
      memavail <- min(memavail, cgroup_limit)
    }
    memmax <- as.numeric(mi)[3]
    list(memavail = memavail, memmax = memmax)
  }, error = function(e) {
    list(memavail = cgroup_limit, memmax = NA_real_)
  })
}
