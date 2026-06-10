#!/usr/bin/env Rscript
# Generate synthetic occurrence data with cleaning challenges.
# Run from project root:  Rscript scripts/generate_synthetic_data.R
# Outputs: data/examples/synthetic_presence_data.csv
#          data/examples/multi_species_test.csv

set.seed(42)

# ─── Parameters ────────────────────────────────────────────────────────────
n_clean <- 1000L
n_dirty <- 100L
ranges <- list(
  Synthetic_North = list(lon = c(145, 153), lat = c(-24, -16), species = "Species_North"),
  Synthetic_East  = list(lon = c(145, 153), lat = c(-38, -25), species = "Species_East"),
  Synthetic_West  = list(lon = c(113, 120), lat = c(-35, -22), species = "Species_West")
)
group_names <- names(ranges)

# ─── Generate clean records ────────────────────────────────────────────────
build_clean <- function(src, r, n) {
  data.frame(
    longitude = round(runif(n, r$lon[1], r$lon[2]), 4),
    latitude  = round(runif(n, r$lat[1], r$lat[2]), 4),
    source    = src,
    species   = r$species,
    countryCode = "AU",
    basisOfRecord = "HumanObservation",
    occurrenceStatus = "present",
    coordinateUncertaintyInMeters = 10L,
    stringsAsFactors = FALSE
  )
}

clean <- do.call(rbind, lapply(group_names, function(src) {
  build_clean(src, ranges[[src]], n_clean)
}))

# ─── Inject dirty records ──────────────────────────────────────────────────
src <- function() sample(group_names, 1)

# Track dirty rows (will rbind at end)
dirty <- list()

# 1. NA in longitude
dirty[[length(dirty) + 1]] <- data.frame(
  longitude = NA_real_, latitude = -30, source = src(),
  species = "Species_East", countryCode = "AU",
  basisOfRecord = "HumanObservation", occurrenceStatus = "present",
  coordinateUncertaintyInMeters = 10L
)

# 2. Non-finite coordinates
dirty[[length(dirty) + 1]] <- data.frame(
  longitude = Inf, latitude = -30, source = src(),
  species = "Species_East", countryCode = "AU",
  basisOfRecord = "HumanObservation", occurrenceStatus = "present",
  coordinateUncertaintyInMeters = 10L
)
dirty[[length(dirty) + 1]] <- data.frame(
  longitude = -30, latitude = NaN, source = src(),
  species = "Species_East", countryCode = "AU",
  basisOfRecord = "HumanObservation", occurrenceStatus = "present",
  coordinateUncertaintyInMeters = 10L
)

# 3. Out-of-bounds coordinates
dirty[[length(dirty) + 1]] <- data.frame(
  longitude = 200, latitude = -30, source = src(),
  species = "Species_East", countryCode = "AU",
  basisOfRecord = "HumanObservation", occurrenceStatus = "present",
  coordinateUncertaintyInMeters = 10L
)
dirty[[length(dirty) + 1]] <- data.frame(
  longitude = -30, latitude = 95, source = src(),
  species = "Species_East", countryCode = "AU",
  basisOfRecord = "HumanObservation", occurrenceStatus = "present",
  coordinateUncertaintyInMeters = 10L
)
dirty[[length(dirty) + 1]] <- data.frame(
  longitude = -200, latitude = -30, source = src(),
  species = "Species_East", countryCode = "AU",
  basisOfRecord = "HumanObservation", occurrenceStatus = "present",
  coordinateUncertaintyInMeters = 10L
)

# 4. occurrenceStatus = "absent"
for (i in 1:10) {
  r <- ranges[[src()]]
  dirty[[length(dirty) + 1]] <- data.frame(
    longitude = round(runif(1, r$lon[1], r$lon[2]), 4),
    latitude  = round(runif(1, r$lat[1], r$lat[2]), 4),
    source    = src(),
    species   = r$species,
    countryCode = "AU",
    basisOfRecord = "HumanObservation",
    occurrenceStatus = "absent",
    coordinateUncertaintyInMeters = 10L
  )
}

# 5. Duplicate (lon, lat, source) tuples — copy 10 clean rows
dup_rows <- clean[sample(nrow(clean), 10), ]
dup_rows$occurrenceStatus <- "present"
dirty[[length(dirty) + 1]] <- dup_rows

# 6. Small source (< 15 records)
small_src <- "Small_Herbarium"
for (i in 1:8) {
  r <- ranges[["Synthetic_East"]]
  dirty[[length(dirty) + 1]] <- data.frame(
    longitude = round(runif(1, 146, 152), 4),
    latitude  = round(runif(1, -36, -26), 4),
    source    = small_src,
    species   = "Species_East",
    countryCode = "AU",
    basisOfRecord = "PreservedSpecimen",
    occurrenceStatus = "present",
    coordinateUncertaintyInMeters = 10L
  )
}

# 7. CC test: zeros (0, 0)
dirty[[length(dirty) + 1]] <- data.frame(
  longitude = 0, latitude = 0, source = src(),
  species = "Species_East", countryCode = "AU",
  basisOfRecord = "HumanObservation", occurrenceStatus = "present",
  coordinateUncertaintyInMeters = 10L
)

# 8. CC test: sea (open ocean)
ocean_pts <- list(
  c(-30, -30), c(160, -40), c(100, -10), c(170, -20), c(-50, -40)
)
for (pt in ocean_pts) {
  dirty[[length(dirty) + 1]] <- data.frame(
    longitude = pt[1], latitude = pt[2], source = src(),
    species = "Species_East", countryCode = "AU",
    basisOfRecord = "HumanObservation", occurrenceStatus = "present",
    coordinateUncertaintyInMeters = 10L
  )
}

# 9. CC test: capitals (Canberra ~149.13, -35.28)
dirty[[length(dirty) + 1]] <- data.frame(
  longitude = 149.13, latitude = -35.28, source = src(),
  species = "Species_East", countryCode = "AU",
  basisOfRecord = "HumanObservation", occurrenceStatus = "present",
  coordinateUncertaintyInMeters = 10L
)

# 10. CC test: institutions (known museum coords)
# Australian Museum, Sydney: ~151.21, -33.87
dirty[[length(dirty) + 1]] <- data.frame(
  longitude = 151.21, latitude = -33.87, source = src(),
  species = "Species_East", countryCode = "AU",
  basisOfRecord = "PreservedSpecimen", occurrenceStatus = "present",
  coordinateUncertaintyInMeters = 10L
)
# Queensland Museum, Brisbane: ~153.02, -27.47
dirty[[length(dirty) + 1]] <- data.frame(
  longitude = 153.02, latitude = -27.47, source = src(),
  species = "Species_East", countryCode = "AU",
  basisOfRecord = "PreservedSpecimen", occurrenceStatus = "present",
  coordinateUncertaintyInMeters = 10L
)

# 11. High coordinate uncertainty
for (i in 1:8) {
  r <- ranges[[src()]]
  dirty[[length(dirty) + 1]] <- data.frame(
    longitude = round(runif(1, r$lon[1], r$lon[2]), 4),
    latitude  = round(runif(1, r$lat[1], r$lat[2]), 4),
    source    = src(),
    species   = r$species,
    countryCode = "AU",
    basisOfRecord = "HumanObservation",
    occurrenceStatus = "present",
    coordinateUncertaintyInMeters = 5000L
  )
}

# 12. Outside raster extent (far from Australian mainland)
dirty[[length(dirty) + 1]] <- data.frame(
  longitude = 80, latitude = -50, source = src(),
  species = "Species_East", countryCode = "AU",
  basisOfRecord = "HumanObservation", occurrenceStatus = "present",
  coordinateUncertaintyInMeters = 10L
)
dirty[[length(dirty) + 1]] <- data.frame(
  longitude = 170, latitude = 10, source = src(),
  species = "Species_East", countryCode = "AU",
  basisOfRecord = "HumanObservation", occurrenceStatus = "present",
  coordinateUncertaintyInMeters = 10L
)

# 13. Close pairs (within 0.01 deg — same 10-arcmin raster cell)
base_lon <- 150.00
base_lat <- -35.00
for (i in 1:5) {
  off <- (i - 1) * 0.003
  dirty[[length(dirty) + 1]] <- data.frame(
    longitude = base_lon + off, latitude = base_lat + off,
    source = src(), species = "Species_East", countryCode = "AU",
    basisOfRecord = "HumanObservation", occurrenceStatus = "present",
    coordinateUncertaintyInMeters = 10L
  )
  dirty[[length(dirty) + 1]] <- data.frame(
    longitude = base_lon + off + 0.005, latitude = base_lat + off + 0.005,
    source = src(), species = "Species_East", countryCode = "AU",
    basisOfRecord = "HumanObservation", occurrenceStatus = "present",
    coordinateUncertaintyInMeters = 10L
  )
}

# ─── Combine and write ─────────────────────────────────────────────────────
dirty_df <- do.call(rbind, dirty)
rownames(dirty_df) <- NULL

# Fix column types for clean bind
clean$longitude <- as.numeric(clean$longitude)
dirty_df$longitude <- as.numeric(dirty_df$longitude)
clean$latitude <- as.numeric(clean$latitude)
dirty_df$latitude <- as.numeric(dirty_df$latitude)
clean$coordinateUncertaintyInMeters <- as.integer(clean$coordinateUncertaintyInMeters)
dirty_df$coordinateUncertaintyInMeters <- as.integer(dirty_df$coordinateUncertaintyInMeters)

out1 <- rbind(clean, dirty_df)
out1 <- out1[sample(nrow(out1)), ]
rownames(out1) <- NULL

write.csv(out1, "data/examples/synthetic_presence_data.csv", row.names = FALSE)

# ─── Multi-species CSV (species column first) ──────────────────────────────
clean2 <- clean
clean2$species <- sub("Synthetic_", "Species_", clean2$source)
# Reorder columns to match multi-species file convention
out2 <- out1
out2$species <- sub("Synthetic_", "Species_", out2$source)
out2 <- out2[, c("species", "longitude", "latitude", "source", "countryCode",
                  "occurrenceStatus", "coordinateUncertaintyInMeters")]
out2 <- out2[sample(nrow(out2)), ]
rownames(out2) <- NULL

write.csv(out2, "data/examples/multi_species_test.csv", row.names = FALSE)

# ─── Summary ───────────────────────────────────────────────────────────────
cat(sprintf("synthetic_presence_data.csv: %d rows\n", nrow(out1)))
cat(sprintf("  clean: %d (%.0f%%)\n", n_clean * 3, n_clean * 3 / nrow(out1) * 100))
cat(sprintf("  dirty: %d (%.0f%%)\n", nrow(out1) - n_clean * 3,
            (nrow(out1) - n_clean * 3) / nrow(out1) * 100))
cat(sprintf("multi_species_test.csv: %d rows\n", nrow(out2)))
