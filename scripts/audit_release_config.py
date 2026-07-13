#!/usr/bin/env python3
"""Static release/version/image audit; no registry or Docker daemon required."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$")


def fail(message: str) -> None:
    raise SystemExit(f"release config audit failed: {message}")


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def service_block(compose: str, service: str) -> str:
    match = re.search(rf"^  {re.escape(service)}:\n(?P<body>(?:^(?:    |\s*$).*\n?)*)", compose, re.MULTILINE)
    if not match:
        fail(f"missing {service} service in docker-compose.prod.yml")
    return match.group("body")


def git(*args: str) -> str:
    result = subprocess.run(["git", "-C", str(ROOT), *args], text=True, capture_output=True)
    if result.returncode:
        fail(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout.strip()


def validate_semver(value: str, label: str) -> re.Match[str]:
    match = SEMVER.fullmatch(value)
    if not match:
        fail(f"{label} is not strict SemVer: {value!r}")
    prerelease = match.group(4)
    if prerelease and any(part.isdigit() and len(part) > 1 and part.startswith("0") for part in prerelease.split(".")):
        fail(f"{label} has a zero-prefixed numeric prerelease identifier: {value!r}")
    return match


version = read("VERSION").strip()
validate_semver(version, "VERSION")
for package_file in ("api/package.json", "frontend/package.json", "packages/shared/package.json"):
    package_version = json.loads(read(package_file)).get("version")
    if package_version != version:
        fail(f"{package_file} version {package_version!r} != VERSION {version!r}")

cff = read("CITATION.cff")
match = re.search(r'^version:\s*["\']?([^"\'\s]+)', cff, re.MULTILINE)
if not match or match.group(1) != version:
    fail("CITATION.cff version does not match VERSION")
date_match = re.search(r'^date-released:\s*["\']?(\d{4}-\d{2}-\d{2})', cff, re.MULTILINE)
if not date_match:
    fail("CITATION.cff has no valid date-released field")
try:
    date.fromisoformat(date_match.group(1))
except ValueError as error:
    fail(f"invalid CITATION.cff date-released: {error}")

images_env = read("deploy/images.env.example")
if f"SDM_RELEASE_VERSION={version}" not in images_env:
    fail("deploy/images.env.example does not match VERSION")

compose = read("docker-compose.prod.yml")
expected_refs = {
    "frontend": "sdm-frontend@${SDM_FRONTEND_DIGEST:",
    "api": "sdm-api@${SDM_API_DIGEST:",
    "plumber": "sdm-plumber-${SDM_PLUMBER_VARIANT:-cpu}@${SDM_PLUMBER_DIGEST:",
}
for service, expected in expected_refs.items():
    block = service_block(compose, service)
    if "build:" in block:
        fail(f"production {service} must pull, not build")
    if expected not in block:
        fail(f"production {service} is not pinned by the expected digest variable")
    if ":latest" in block:
        fail(f"production {service} uses latest")

workflow = read(".github/workflows/release.yml")
for image in ("sdm-plumber-cpu", "sdm-plumber-cuda", "sdm-plumber-rocm", "sdm-api", "sdm-frontend"):
    if image not in workflow:
        fail(f"release workflow does not publish {image}")
for dockerfile in ("plumber/Dockerfile", "plumber/Dockerfile.cuda", "plumber/Dockerfile.rocm", "Dockerfile.api", "Dockerfile.frontend"):
    if dockerfile not in workflow:
        fail(f"release workflow does not build {dockerfile}")
for contract in ("environment: release", "type=semver,pattern={{version}}", "type=sha,format=long,prefix=sha-", "flavor: latest=false", "provenance: mode=max", "sbom: true", "steps.build.outputs.digest", "image-digests"):
    if contract not in workflow:
        fail(f"release workflow is missing contract: {contract}")
if re.search(r"type=raw,value=latest|type=raw,value=stable", workflow):
    fail("release workflow must not publish mutable latest/stable aliases")

for overlay in ("deploy/compose.cuda.yml", "deploy/compose.rocm.yml"):
    overlay_text = read(overlay)
    if "build:" in overlay_text:
        fail(f"{overlay} must not reintroduce a production build")

for path, accelerator in (
    ("plumber/Dockerfile", 'org.opencontainers.image.accelerator="cpu"'),
    ("plumber/Dockerfile.cuda", 'org.opencontainers.image.accelerator="nvidia-cuda"'),
    ("plumber/Dockerfile.rocm", 'org.opencontainers.image.accelerator="amd-rocm"'),
):
    if accelerator not in read(path):
        fail(f"{path} is missing accelerator identity {accelerator}")

if len(sys.argv) > 2:
    fail("usage: audit_release_config.py [vMAJOR.MINOR.PATCH[-PRERELEASE]]")
if len(sys.argv) == 2:
    tag = sys.argv[1]
    if not tag.startswith("v"):
        fail(f"release tag is not v-prefixed: {tag!r}")
    validate_semver(tag[1:], "release tag")
    if tag[1:] != version:
        fail(f"tag {tag!r} does not match VERSION v{version}")
    changelog = read("CHANGELOG.md")
    if not re.search(rf"^## (?:\[{re.escape(version)}\]|v{re.escape(version)})(?:\s|$)", changelog, re.MULTILINE):
        fail(f"CHANGELOG.md has no release heading for {version}")
    if git("rev-parse", "HEAD") != git("rev-list", "-n", "1", tag):
        fail(f"{tag} does not resolve to checked-out HEAD")

print(f"Release config audit passed for {version}" + (f" ({sys.argv[1]})" if len(sys.argv) == 2 else ""))
