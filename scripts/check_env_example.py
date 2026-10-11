#!/usr/bin/env python3
"""Fail if production Compose requires a variable that .env.example does not define.

`check:compose` validates Compose with dummy values for every variable, so it
cannot notice when .env.example (the file operators copy) is missing one. This
compares the two directly. Image digests and the Plumber variant come from the
release's release-images.env, and the AMD group IDs are documented as optional
commented entries, so those are accepted when present as comments.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
COMPOSE_FILES = ["docker-compose.prod.yml", "deploy/compose.cuda.yml", "deploy/compose.rocm.yml"]
FROM_RELEASE_ENV = {"SDM_FRONTEND_DIGEST", "SDM_API_DIGEST", "SDM_PLUMBER_DIGEST"}

required = set()
for name in COMPOSE_FILES:
    required |= set(re.findall(r"\$\{([A-Z0-9_]+):\?", (ROOT / name).read_text()))

example = (ROOT / ".env.example").read_text()
defined = set(re.findall(r"^([A-Z0-9_]+)=", example, re.M))
commented = set(re.findall(r"^#\s*([A-Z0-9_]+)=", example, re.M))

missing = sorted(v for v in required - FROM_RELEASE_ENV if v not in defined and v not in commented)
if missing:
    print(".env.example is missing variables required by production Compose: " + ", ".join(missing))
    sys.exit(1)
print(f".env.example covers all {len(required - FROM_RELEASE_ENV)} required production variables")
