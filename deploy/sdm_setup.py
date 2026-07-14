#!/usr/bin/env python3
"""Prepare and diagnose a digest-pinned SDM Dashboard beta.6 deployment."""
from __future__ import annotations
import argparse, json, os, platform, re, secrets, shutil, socket, subprocess, sys
from pathlib import Path

BUNDLE_VERSION = "2.0.0-beta.6"
REQUIRED_IMAGES = ("SDM_FRONTEND_DIGEST", "SDM_API_DIGEST", "SDM_PLUMBER_DIGEST")
REQUIRED_PORTS = (80, 443, 3900, 9187, 9121, 9090, 3001)
MIN_MEMORY_BYTES = 12 * 1024**3
MIN_DISK_BYTES = 30 * 1024**3

class SetupError(RuntimeError): pass

def run(command: list[str], runner=subprocess.run):
    try:
        return runner(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
    except OSError as exc:
        return type("Result", (), {"returncode": 127, "stdout": "", "stderr": str(exc)})()

def parse_env(path: Path) -> dict[str, str]:
    values = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1); values[key] = value
    return values

def validate_images(images: dict[str, str]) -> None:
    missing = [key for key in REQUIRED_IMAGES if not re.fullmatch(r"sha256:[a-fA-F0-9]{64}", images.get(key, ""))]
    if missing: raise SetupError("image metadata must contain immutable sha256 digests for: " + ", ".join(missing))
    variant = images.get("SDM_PLUMBER_VARIANT", "cpu")
    if variant not in ("cpu", "cuda", "rocm"): raise SetupError("SDM_PLUMBER_VARIANT must be cpu, cuda, or rocm")

def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return sock.connect_ex(("127.0.0.1", port)) != 0

def host_memory() -> int:
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemTotal:"): return int(line.split()[1]) * 1024
    except OSError: pass
    return 0

def detect_accelerators(root: Path = Path("/")) -> dict[str, bool]:
    dev = root / "dev"
    nvidia = any(dev.glob("nvidia[0-9]*")) or (root / "proc/driver/nvidia/gpus").exists()
    amd = (dev / "kfd").exists() and (dev / "dri").exists()
    return {"nvidia": nvidia, "amd": amd}

def accelerator_image(images: dict[str, str], accelerator: str) -> str:
    return "ghcr.io/unstable-branch/sdm-dashboard/sdm-plumber-{}@{}".format(
        {"nvidia": "cuda", "amd": "rocm"}[accelerator], images["SDM_PLUMBER_DIGEST"])

def runtime_probe(accelerator: str, images: dict[str, str], runner=subprocess.run) -> tuple[bool, str]:
    image = accelerator_image(images, accelerator)
    cmd = ["docker", "run", "--rm"]
    if accelerator == "nvidia": cmd += ["--gpus", "all"]
    else: cmd += ["--device", "/dev/kfd", "--device", "/dev/dri"]
    result = run(cmd + ["--entrypoint", "/bin/true", image], runner)
    return result.returncode == 0, (result.stderr or result.stdout).strip()

def select_accelerator(requested: str, detected: dict[str, bool], images: dict[str, str], probe=runtime_probe) -> tuple[str, str]:
    if requested == "cpu": return "cpu", "CPU selected by operator"
    variants = {"nvidia": "cuda", "amd": "rocm"}
    candidates = [name for name in ("nvidia", "amd") if detected[name] and images.get("SDM_PLUMBER_VARIANT") == variants[name]]
    if requested != "auto":
        if images.get("SDM_PLUMBER_VARIANT") != variants[requested]:
            raise SetupError(f"image metadata selects {images.get('SDM_PLUMBER_VARIANT', 'cpu')}; it cannot be used for requested {requested}")
        if not detected[requested]: raise SetupError(f"requested {requested} accelerator is not present on the host")
        ok, detail = probe(requested, images)
        if not ok: raise SetupError(f"requested {requested} Docker runtime probe failed: {detail or 'unknown error'}")
        return requested, f"{requested} Docker runtime probe passed"
    for candidate in candidates:
        ok, detail = probe(candidate, images)
        if ok: return candidate, f"{candidate} Docker runtime probe passed"
    detail = "no GPU devices detected" if not candidates else "GPU runtime probe failed"
    return "cpu", f"CPU fallback: {detail}"

def preflight(deployment: Path, images: dict[str, str] | None = None, requested: str = "auto", runner=subprocess.run) -> dict:
    errors, warnings = [], []
    if platform.system() != "Linux": errors.append("Linux host required")
    if platform.machine().lower() not in ("x86_64", "amd64", "aarch64", "arm64"): errors.append("unsupported Linux architecture: " + platform.machine())
    if shutil.which("docker") is None: errors.append("Docker CLI not found")
    else:
        docker = run(["docker", "info"], runner)
        if docker.returncode: errors.append("Docker daemon is unavailable: " + (docker.stderr.strip() or "docker info failed"))
        compose = run(["docker", "compose", "version"], runner)
        if compose.returncode: errors.append("Docker Compose v2 plugin is required")
    if host_memory() < MIN_MEMORY_BYTES: errors.append("at least 12 GiB memory is required")
    disk_free = 0
    try:
        disk_free = shutil.disk_usage(deployment.parent).free
        if disk_free < MIN_DISK_BYTES: errors.append("at least 30 GiB free disk is required")
    except OSError as exc: errors.append("cannot inspect deployment disk: " + str(exc))
    writable = deployment if deployment.exists() else deployment.parent
    if not os.access(writable, os.W_OK): errors.append("deployment path is not writable: " + str(writable))
    busy = [str(port) for port in REQUIRED_PORTS if not port_free(port)]
    if busy: errors.append("required host ports already in use: " + ", ".join(busy))
    detection = detect_accelerators()
    selected, accelerator_note = "cpu", "accelerator selection skipped"
    if images:
        try:
            selected, accelerator_note = select_accelerator(requested, detection, images, lambda a, i: runtime_probe(a, i, runner))
            if selected == "cpu" and images.get("SDM_PLUMBER_VARIANT", "cpu") != "cpu":
                errors.append("CPU fallback requires reviewed CPU image metadata, not " + images["SDM_PLUMBER_VARIANT"])
        except SetupError as exc:
            errors.append(str(exc))
    return {"ok": not errors, "errors": errors, "warnings": warnings, "memory_bytes": host_memory(), "disk_free_bytes": disk_free, "accelerators": detection, "selected_accelerator": selected, "accelerator_note": accelerator_note}

def secret_values() -> dict[str, str]:
    token = lambda n=32: secrets.token_urlsafe(n)
    return {"POSTGRES_PASSWORD": token(), "JWT_SECRET": token(48), "CSRF_SECRET": token(48), "PLUMBER_INTERNAL_KEY": token(48), "DATA_ENCRYPTION_KEY": secrets.token_hex(32), "SDM_ENCRYPTION_KEY": secrets.token_hex(32), "GARAGE_ACCESS_KEY": token(18), "GARAGE_SECRET_KEY": token(32), "GARAGE_RPC_SECRET": secrets.token_hex(32), "GARAGE_ADMIN_TOKEN": token(32), "GRAFANA_PASSWORD": token(), "GARAGE_BUCKET_RASTERS": "sdm-rasters", "GARAGE_BUCKET_EXPORTS": "sdm-exports"}

def deployment_values(path: Path, accelerator: str) -> dict[str, str]:
    """Create only values absent from the deployment file, keeping DB credentials coherent."""
    existing = parse_env(path) if path.exists() else {}
    values = secret_values()
    postgres_password = existing.get("POSTGRES_PASSWORD") or values["POSTGRES_PASSWORD"]
    values["DATABASE_URL"] = "postgresql://sdm:{}@postgres:5432/sdm_platform".format(postgres_password)
    values["SDM_SETUP_BUNDLE_VERSION"] = BUNDLE_VERSION
    values["SDM_PLUMBER_VARIANT"] = {"nvidia": "cuda", "amd": "rocm", "cpu": "cpu"}[accelerator]
    return values

def write_env_missing(path: Path, values: dict[str, str], dry_run: bool) -> list[str]:
    existing = parse_env(path) if path.exists() else {}
    additions = {k: v for k, v in values.items() if not existing.get(k)}
    if additions and not dry_run:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        with os.fdopen(fd, "a") as output:
            if path.stat().st_size: output.write("\n")
            for key, value in additions.items(): output.write(f"{key}={value}\n")
        os.chmod(path, 0o600)
    return sorted(additions)

def prepare(args) -> int:
    images_path = Path(args.images_file).resolve(); deployment = Path(args.deployment_dir).resolve()
    images = parse_env(images_path); validate_images(images)
    report = preflight(deployment, images, args.accelerator)
    print(json.dumps(report, indent=2, sort_keys=True))
    if not report["ok"]: return 2
    selected = report["selected_accelerator"]
    config_path = deployment / ".env"
    generated = write_env_missing(config_path, deployment_values(config_path, selected), args.dry_run)
    if not args.dry_run:
        target_images = deployment / "images.env"
        if target_images.exists() and parse_env(target_images) != images: raise SetupError("refusing to replace existing image metadata; review it explicitly")
        if not target_images.exists(): target_images.write_text(images_path.read_text()); os.chmod(target_images, 0o600)
    print(("would generate" if args.dry_run else "generated") + " config keys: " + (", ".join(generated) or "none (idempotent)"))
    print("next: docker compose --env-file images.env --env-file .env -f <repo>/docker-compose.prod.yml up -d --no-build")
    return 0

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--version", action="version", version=BUNDLE_VERSION)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("prepare", "diagnose"):
        command = sub.add_parser(name); command.add_argument("--deployment-dir", required=True); command.add_argument("--images-file", required=True); command.add_argument("--accelerator", choices=("auto", "cpu", "nvidia", "amd"), default="auto"); command.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.command == "diagnose":
            images = parse_env(Path(args.images_file))
            validate_images(images)
            report = preflight(Path(args.deployment_dir), images, args.accelerator)
            print(json.dumps(report, indent=2, sort_keys=True))
            return 0 if report["ok"] else 2
        return prepare(args)
    except SetupError as exc: print("error: " + str(exc), file=sys.stderr); return 2
if __name__ == "__main__": raise SystemExit(main())
