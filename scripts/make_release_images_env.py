#!/usr/bin/env python3
"""Generate a ready-to-use CPU-default Compose image environment file."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {
    "sdm-api",
    "sdm-frontend",
    "sdm-plumber-cpu",
    "sdm-plumber-cuda",
    "sdm-plumber-rocm",
}
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
PREFIX = "ghcr.io/unstable-branch/sdm-dashboard/"


def fail(message: str) -> None:
    raise SystemExit(f"release image environment generation failed: {message}")


def main() -> None:
    if len(sys.argv) != 3:
        fail("usage: make_release_images_env.py IMAGE_DIGESTS_FILE OUTPUT_FILE")

    source = Path(sys.argv[1])
    output = Path(sys.argv[2])
    if not source.is_file():
        fail(f"digest manifest does not exist: {source}")

    images: dict[str, str] = {}
    for line_number, raw_line in enumerate(source.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line:
            continue
        if "@" not in line:
            fail(f"{source}:{line_number} is not IMAGE@DIGEST")
        image, digest = line.rsplit("@", 1)
        if not image.startswith(PREFIX):
            fail(f"unexpected registry path: {image}")
        name = image.removeprefix(PREFIX)
        if name in images:
            fail(f"duplicate image: {name}")
        if not DIGEST_RE.fullmatch(digest):
            fail(f"invalid digest for {name}: {digest}")
        images[name] = digest

    if set(images) != EXPECTED:
        fail(
            f"image set mismatch; missing={sorted(EXPECTED - set(images))}, "
            f"unexpected={sorted(set(images) - EXPECTED)}"
        )

    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    content = f"""# Generated from the reviewed immutable image digests for v{version}.
# Use after your secret-bearing .env file: docker compose --env-file .env --env-file release-images.env ...
# CPU is the default. For NVIDIA or AMD, replace the two active Plumber values
# with the commented CUDA or ROCm pair and use the matching Compose overlay.
SDM_RELEASE_VERSION={version}
SDM_FRONTEND_DIGEST={images['sdm-frontend']}
SDM_API_DIGEST={images['sdm-api']}
SDM_PLUMBER_VARIANT=cpu
SDM_PLUMBER_DIGEST={images['sdm-plumber-cpu']}

# NVIDIA CUDA alternative:
# SDM_PLUMBER_VARIANT=cuda
# SDM_PLUMBER_DIGEST={images['sdm-plumber-cuda']}

# AMD ROCm alternative:
# SDM_PLUMBER_VARIANT=rocm
# SDM_PLUMBER_DIGEST={images['sdm-plumber-rocm']}
"""
    output.write_text(content, encoding="utf-8")
    print(f"Generated release image environment: {output}")


if __name__ == "__main__":
    main()
