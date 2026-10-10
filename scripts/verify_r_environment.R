#!/usr/bin/env Rscript

fail <- function(message) stop(message, call. = FALSE)

assert_r_version <- function(expected, actual = as.character(getRversion())) {
  if (!identical(actual, expected)) {
    fail(sprintf("R version mismatch: expected %s, found %s", expected, actual))
  }
  invisible(TRUE)
}

check_locked_versions <- function(packages, libpaths) {
  problems <- character()
  for (name in names(packages)) {
    expected <- packages[[name]]$Version
    candidates <- file.path(libpaths, name, "DESCRIPTION")
    descriptions <- candidates[file.exists(candidates)]
    if (!length(descriptions)) {
      problems <- c(problems, sprintf("%s missing (expected %s)", name, expected))
      next
    }
    description <- read.dcf(descriptions[[1L]], fields = "Version")
    actual <- unname(description[1L, "Version"])
    if (!identical(actual, expected)) {
      problems <- c(problems, sprintf("%s expected %s, found %s", name, expected, actual))
    }
  }
  if (length(problems)) fail(paste("Locked package versions do not match:", paste(problems, collapse = "; ")))
  invisible(TRUE)
}

verify_lock <- function(lockfile = "renv.lock", libpaths = .libPaths()) {
  lock <- jsonlite::fromJSON(lockfile, simplifyVector = FALSE)
  expected_r <- lock$R$Version
  if (is.null(expected_r) || !nzchar(expected_r)) fail("renv.lock is missing R.Version")
  assert_r_version(expected_r)
  if (!is.list(lock$Packages) || !length(lock$Packages)) fail("renv.lock has no package records")
  check_locked_versions(lock$Packages, libpaths)

  status <- renv::status()
  if (!isTRUE(status$synchronized)) fail("renv::status() reports an unsynchronized project")
  message(sprintf("R %s; all %d locked package DESCRIPTION versions match; renv is synchronized.",
                  expected_r, length(lock$Packages)))
  invisible(lock)
}

verify_cpu_torch <- function() {
  if (!requireNamespace("torch", quietly = TRUE)) fail("The locked torch R package is unavailable")
  if (!isTRUE(torch::torch_is_installed())) fail("CPU LibTorch is not installed")
  result <- torch::torch_tensor(c(1, 2, 3), device = "cpu")$sum()$item()
  if (!identical(as.numeric(result), 6)) fail(sprintf("CPU LibTorch tensor probe returned %s, expected 6", result))
  message("CPU LibTorch tensor probe passed (1 + 2 + 3 = 6).")
  invisible(TRUE)
}

expect_failure <- function(label, expression) {
  did_fail <- inherits(try(force(expression), silent = TRUE), "try-error")
  if (!did_fail) fail(sprintf("Negative fixture unexpectedly passed: %s", label))
  message(sprintf("Negative fixture rejected: %s", label))
}

run_self_test <- function() {
  root <- tempfile("verify-renv-fixtures-")
  dir.create(root)
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  lib <- file.path(root, "library")
  dir.create(lib)
  write_package <- function(name, version) {
    folder <- file.path(lib, name)
    dir.create(folder)
    write.dcf(data.frame(Package = name, Version = version), file.path(folder, "DESCRIPTION"))
  }
  write_package("goodpkg", "1.2.3")
  write_package("badpkg", "9.9.9")
  fixtures <- list(goodpkg = list(Version = "1.2.3"), badpkg = list(Version = "1.2.3"))
  check_locked_versions(fixtures["goodpkg"], lib)
  expect_failure("locked package version mismatch", check_locked_versions(fixtures["badpkg"], lib))
  expect_failure("missing locked package", check_locked_versions(list(absentpkg = list(Version = "1.0")), lib))
  expect_failure("wrong R runtime version", assert_r_version("0.0.0", actual = "4.5.0"))
  message("Environment verifier negative fixtures passed.")
}

args <- commandArgs(trailingOnly = TRUE)
if (identical(args, "--self-test")) {
  run_self_test()
} else if (identical(args, "--lock")) {
  verify_lock()
} else if (identical(args, "--torch")) {
  verify_lock()
  verify_cpu_torch()
} else {
  fail("Usage: Rscript scripts/verify_r_environment.R --self-test|--lock|--torch")
}
