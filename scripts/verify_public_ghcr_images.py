#!/usr/bin/env python3
"""Verify release images can be resolved from GHCR without authentication."""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

EXPECTED_IMAGES = {
    "ghcr.io/unstable-branch/sdm-dashboard/sdm-api",
    "ghcr.io/unstable-branch/sdm-dashboard/sdm-frontend",
    "ghcr.io/unstable-branch/sdm-dashboard/sdm-plumber-cpu",
    "ghcr.io/unstable-branch/sdm-dashboard/sdm-plumber-cuda",
    "ghcr.io/unstable-branch/sdm-dashboard/sdm-plumber-rocm",
}
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
MANIFEST_ACCEPT = ", ".join(
    (
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    )
)


def fail(message: str) -> None:
    raise SystemExit(f"public image verification failed: {message}")


def request_json(url: str) -> dict[str, object]:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "sdm-dashboard-release-check"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
        fail(f"anonymous registry token request failed: {error}")


def verify_manifest(image: str, digest: str) -> None:
    repository = image.removeprefix("ghcr.io/")
    token_url = "https://ghcr.io/token?" + urllib.parse.urlencode(
        {"service": "ghcr.io", "scope": f"repository:{repository}:pull"}
    )
    token = request_json(token_url).get("token")
    if not isinstance(token, str) or not token:
        fail(f"GHCR did not issue an anonymous pull token for {image}")

    request = urllib.request.Request(
        f"https://ghcr.io/v2/{repository}/manifests/{digest}",
        headers={
            "Accept": MANIFEST_ACCEPT,
            "Authorization": f"Bearer {token}",
            "User-Agent": "sdm-dashboard-release-check",
        },
        method="HEAD",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            resolved = response.headers.get("Docker-Content-Digest")
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            fail(f"{image} is not anonymously pullable (HTTP {error.code}); make the GHCR package public")
        fail(f"manifest lookup failed for {image}@{digest}: HTTP {error.code}")
    except (urllib.error.URLError, TimeoutError) as error:
        fail(f"manifest lookup failed for {image}@{digest}: {error}")

    if resolved and resolved != digest:
        fail(f"{image} resolved to {resolved}, expected {digest}")
    print(f"public image verified: {image}@{digest}")


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: verify_public_ghcr_images.py IMAGE_DIGESTS_FILE")
    path = Path(sys.argv[1])
    if not path.is_file():
        fail(f"digest manifest does not exist: {path}")

    entries: dict[str, str] = {}
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line:
            continue
        if "@" not in line:
            fail(f"{path}:{line_number} is not IMAGE@DIGEST")
        image, digest = line.rsplit("@", 1)
        if image in entries:
            fail(f"duplicate image in digest manifest: {image}")
        if not DIGEST_RE.fullmatch(digest):
            fail(f"invalid digest for {image}: {digest}")
        entries[image] = digest

    found = set(entries)
    if found != EXPECTED_IMAGES:
        missing = sorted(EXPECTED_IMAGES - found)
        unexpected = sorted(found - EXPECTED_IMAGES)
        fail(f"digest manifest image set mismatch; missing={missing}, unexpected={unexpected}")

    for image in sorted(entries):
        verify_manifest(image, entries[image])


if __name__ == "__main__":
    main()
