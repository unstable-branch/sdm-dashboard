# Project status

Updated 2026-10-11. The historical recovery snapshots are preserved in [archive/STATUS-pre-3.0.md](archive/STATUS-pre-3.0.md).

## 3.0 release scope

SDM Dashboard is the authenticated web platform: Next.js, Hono, PostgreSQL/PostGIS, Redis/BullMQ, Garage-compatible storage and the R/Plumber modelling engine. The Shiny desktop application was removed; `v1.0.0` preserves that release line.

Supported deployment topology is **one Plumber replica and one queue worker**. CPU is the default; CUDA is optional. ROCm remains experimental, with GPU modelling through the Python PyTorch bridge; native R torch/cito models use CPU on ROCm. Multi-replica ownership is deferred to 3.1.

## Acceptance evidence

- Required CI passed on the reviewed release-candidate heads: shared package, API, frontend, Docker integration, PostgreSQL migration contract, locked R 4.5.0 full suite, R validation and GPU unit tests. Hardware checks below are separate from CI's conditional GPU tests.
- Published rc.3 CPU workflow: GBIF koala search/save, cleaning, climate download, GLM and MaxNet with 8 cores, results map and GeoTIFF. GLM CV AUC 0.934, MaxNet 0.933. These are workflow checks, not general ecological validation.
- Published rc.3 NVIDIA image: Docker Compose GPU reservation and CUDA computation verified on RTX 3080; browser workflow completed through diagnostics and GeoTIFF. Direct CUDA/CPU prediction agreement, including a reloaded model, was within 1.2e-07 against a fixed 1e-4 threshold. The GLM browser workflow itself uses CPU.
- Published rc.3 ROCm image: RX 6900 XT detected; Python DNN trained on ROCm and predicted 4,096 raster cells, agreeing with CPU within 1.2e-07.
- Published rc.4 images: CUDA-to-ROCm and reverse volume transitions passed with built-in entrypoints, preserved nonce entries, owner-only permissions and retained runtime files. An unpatched rc.4 AMD deployment completed a signed GLM browser run with CV AUC 0.9342 and TSS 0.7866. This addresses the ownership failure exposed by reusing volumes across variants.
- Upgrade fixture: beta.5's 32 registered migrations advanced to rc.3's 45, preserving user/project/run data and allowing idempotent replay. An upgraded backup restored successfully. Real auth and results handlers against the migrated PostgreSQL fixture passed existing-account login, session refresh, historical report download, and anonymous/non-owner denial. This was not a complete deployed upgrade rehearsal; Redis was absent from the handler harness. Operators must back up and rehearse their own data upgrade.
- Terminal-duration UI regression: completed, failed and cancelled runs reopened hours later retain recorded duration. Missing timing is explicitly unavailable. Local frontend suite: 426 passing tests; PR #123 CI passed on its exact reviewed head.

## Remaining limitations

- Durable multi-replica execution ownership and crash recovery are not claimed. Targets execution remains fail-closed; do not present it as a supported distributed execution path.
- DNN is experimental. Built-in small networks can deliberately use CPU despite an attached GPU; DNN CBI is not computed. CUDA/CPU agreement does not establish unchanged predictions across cito serialization: a reload-versus-original drift was observed separately.
- Optional models and dependencies may be unavailable in a given image; consult the deployed model catalog. ESM is opt-in.
- Physical reclamation of shared climate files remains deferred; deletion is a logical lifecycle operation.
- Garage load testing, comprehensive scientific-reference validation, immutable provenance guarantees and multi-replica event replay are not established by these acceptance results.
- Production browser sessions require HTTPS, except the browser's localhost allowance. Use the tagged repository checkout for deployment; the attached source zip is not a complete Compose deployment bundle.

## Stable publication gate

The 3.0.0 preparation builds on the accepted rc.4 code plus the terminal-duration fix. Keep the stable release draft until the exact stable image digests, artifact checksums, deployment smoke test and built-frontend duration check are verified. The published GitHub release, not this preparation document, is the authority for availability.
