# SDM Dashboard Changelog

## v0.5.0 (unreleased)

- Refactored monolithic app.R server into modular structure
- Replaced static hero badges with dynamic status-driven badges
- Moved dark/light theme toggle from sidebar to hero header
- Replaced hardcoded dark-mode CSS hex values with --sdm-* CSS variables
- Removed root-level optimized_sdm.R compatibility shim
- Added all modules to explicit dependency ordering in load.R
