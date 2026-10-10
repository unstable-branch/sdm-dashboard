#!/usr/bin/env python3
"""Run the real registered migration history only on an owned disposable DB."""
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
NAME = "sdm-session-history-pg-20261002"
IMAGE = "docker.io/postgis/postgis:16-3.4@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5"
IMAGE_ID = "sha256:06287eb8e12c43f425773085c48d6ad02d73f8b442ac209810c1b211eb0a643b"
owned = None


def run(args, *, check=True, timeout=15, input_text=None, env=None, cwd=None):
    result = subprocess.run(args, text=True, input=input_text, capture_output=True,
                            timeout=timeout, env=env, cwd=cwd)
    if check and result.returncode:
        raise RuntimeError(f"Command failed: {args[0]} {args[1]}; {result.stderr.strip()}")
    return result


try:
    absent = run(["docker", "inspect", NAME], check=False)
    if absent.returncode == 0 or "No such object" not in absent.stderr:
        raise RuntimeError("Refusing existing test name or uncertain Docker state")
    actual_image = run(["docker", "image", "inspect", IMAGE, "--format", "{{.Id}}"])
    if actual_image.stdout.strip() != IMAGE_ID:
        raise RuntimeError("Pinned production-compatible image unavailable or mismatched")
    created = run(["docker", "create", "--name", NAME, "--label", "sdm.test-purpose=full-session-migration-history",
                   "--cpus", "2", "--memory", "512m", "--tmpfs", "/var/lib/postgresql/data:rw,size=402653184",
                   "-p", "127.0.0.1::5432", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", IMAGE])
    owned = created.stdout.strip()
    info = json.loads(run(["docker", "inspect", owned]).stdout)[0]
    if info["Name"] != f"/{NAME}" or info["Id"] != owned or info["Mounts"]:
        raise RuntimeError("Owned container/mount isolation mismatch")
    run(["docker", "start", owned])
    deadline = time.monotonic() + 60
    while True:
        ready = run(["docker", "exec", owned, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], check=False)
        if ready.returncode == 0:
            break
        if time.monotonic() > deadline:
            raise RuntimeError("Owned PostgreSQL readiness deadline exceeded")
        time.sleep(0.25)
    run(["docker", "exec", owned, "createdb", "-h", "127.0.0.1", "-U", "postgres", "--template=template0", "sdm_session_history_test"])
    info = json.loads(run(["docker", "inspect", owned]).stdout)[0]
    bindings = info["NetworkSettings"]["Ports"]["5432/tcp"]
    if len(bindings) != 1 or bindings[0]["HostIp"] != "127.0.0.1":
        raise RuntimeError("Owned PostgreSQL is not loopback-only")
    port = bindings[0]["HostPort"]
    env = os.environ.copy()
    env["DATABASE_URL"] = "postgresql://postgres@127.0.0.1:1/never_use"
    env["SDM_SESSION_HISTORY_DATABASE_URL"] = f"postgresql://postgres@127.0.0.1:{port}/sdm_session_history_test"
    env["SDM_SESSION_HISTORY_CONTAINER_ID"] = owned
    probe = run(["pnpm", "exec", "tsx", "scripts/verify-browser-session-migration-chain.ts"],
                check=False, timeout=120, env=env, cwd=ROOT / "api")
    print(probe.stdout, end="", flush=True)
    print(probe.stderr, end="", flush=True)
    if probe.returncode:
        raise RuntimeError(f"Full historical migration probe failed (exit {probe.returncode})")
finally:
    if owned:
        removed = run(["docker", "rm", "-f", "-v", owned], check=False, timeout=30)
        exists = run(["docker", "inspect", owned], check=False)
        if removed.returncode or exists.returncode == 0 or "No such object" not in exists.stderr:
            raise RuntimeError("Owned history-test teardown unverified")
        print("HISTORY_TEARDOWN=PASS; owned container absent", flush=True)
