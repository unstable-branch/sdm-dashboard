# Detect available RAM to set R_MAX_VSIZE as 75% of total (cgroup-aware),
# overridable via SDM_CHILD_MAX_VSIZE env var.
sdm_detect_vsize <- function() {
  Sys.getenv("SDM_CHILD_MAX_VSIZE", {
    vsize_gb <- tryCatch({
      mem_total <- readLines("/proc/meminfo", n = 1)
      kb <- as.numeric(gsub(".*:\\s*(\\d+).*", "\\1", mem_total))
      if (is.finite(kb) && kb > 0) max(4L, floor(kb / (1024 * 1024) * 0.75)) else 16L
    }, error = function(e) 16L)
    paste0(vsize_gb, "Gb")
  })
}
