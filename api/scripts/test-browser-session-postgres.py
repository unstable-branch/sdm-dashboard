#!/usr/bin/env python3
"""Run the guarded browser-session PostgreSQL acceptance suite and migration exercise."""
from __future__ import annotations
import json, os, shutil, socket, subprocess, sys, time
from pathlib import Path

API = Path(__file__).resolve().parents[1]
NAME = "sdm-session-lifecycle-pg-20261002"
IMAGE = "postgres:17-alpine"
IMAGE_ID = "sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537"
BASELINE = API / "scripts/browser-session-baseline.sql"
MIGRATION = API / "drizzle/0044_browser_session_lifecycle.sql"
ROLLBACK = API / "drizzle/rollback/0044_browser_session_lifecycle.down.sql"
ENV = os.environ.copy()
created_id: str | None = None

def run(args: list[str], *, timeout: int = 15, check: bool = True, capture: bool = True):
    p = subprocess.run(args, cwd=API, env=ENV, text=True, stdout=subprocess.PIPE if capture else None,
                       stderr=subprocess.PIPE if capture else None, timeout=timeout)
    if check and p.returncode:
        raise RuntimeError(f"command failed ({p.returncode}): {args[0]} {args[1:3]}\n{(p.stderr or '')[-2500:]}")
    return p

def inspect_owned_name():
    result = run(["docker", "inspect", NAME], check=False, timeout=3)
    if result.returncode == 0:
        return json.loads(result.stdout)[0]
    if "No such object" in (result.stderr or ""):
        return None
    raise RuntimeError(f"Docker could not safely inspect the owned name: {(result.stderr or '')[-1000:]}")

def psql(sql: str | None = None, file: Path | None = None, *, user: str = "postgres", db: str = "postgres") -> str:
    if not created_id:
        raise RuntimeError("owned container identity is required before provisioning")
    args = ["docker", "exec", "-i", created_id, "psql", "-X", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", db]
    if file:
        text = file.read_text()
    else:
        text = sql or ""
    if not text:
        return run(args, timeout=15).stdout
    p = subprocess.run(args, input=text, text=True, cwd=API, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
    if p.returncode:
        raise RuntimeError(f"psql synthetic harness command failed ({p.returncode}): {p.stderr[-2500:]}")
    return p.stdout

def apply_breakpoints(path: Path):
    for statement in path.read_text().split("--> statement-breakpoint"):
        if statement.strip(): psql(statement, user="sdm_lifecycle_test", db="sdm_lifecycle_test")

def assert_query(query: str, expected: str):
    actual = psql(query, user="sdm_lifecycle_test", db="sdm_lifecycle_test").strip().splitlines()[-1]
    if actual != expected: raise RuntimeError(f"migration assertion failed: expected {expected!r}, got {actual!r}")

def main():
    global created_id
    if shutil.which("docker") is None: raise RuntimeError("Docker CLI is unavailable")
    # Bound every Docker call; do not contend indefinitely with a busy daemon.
    if inspect_owned_name() is not None:
        raise RuntimeError(f"refusing to reuse existing resource name {NAME}")
    image = json.loads(run(["docker", "image", "inspect", IMAGE], timeout=5).stdout)[0]
    if image.get("Id") != IMAGE_ID:
        raise RuntimeError("the locally available postgres:17-alpine image is not the reviewed immutable image")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
    url = f"postgresql://sdm_lifecycle_test@127.0.0.1:{port}/sdm_lifecycle_test"
    try:
        create = run(["docker", "create", "--name", NAME, "--cpus=2", "--memory=512m",
             "--tmpfs", "/var/lib/postgresql/data:rw,size=480m", "--publish", f"127.0.0.1:{port}:5432",
             "--health-cmd", "pg_isready -U postgres", "--health-interval=2s", "--health-timeout=2s", "--health-retries=20",
             "-e", "POSTGRES_HOST_AUTH_METHOD=trust", IMAGE], timeout=10)
        created_id = create.stdout.strip()
        if len(created_id) != 64 or any(c not in "0123456789abcdef" for c in created_id.lower()):
            raise RuntimeError("Docker create did not return a verifiable container identity")
        run(["docker", "start", created_id], timeout=10)
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            state = json.loads(run(["docker", "inspect", created_id], timeout=3).stdout)[0]
            if state.get("Id") != created_id:
                raise RuntimeError("owned container identity changed before readiness")
            if state.get("State", {}).get("Health", {}).get("Status") == "healthy": break
            if state.get("State", {}).get("Status") not in ("created", "running"): raise RuntimeError("disposable PostgreSQL exited before readiness")
            time.sleep(.5)
        else: raise RuntimeError("disposable PostgreSQL readiness deadline exceeded")
        # Verify the exact owned container shape before provisioning or test imports.
        inspected = json.loads(run(["docker", "inspect", created_id], timeout=3).stdout)[0]
        bindings = inspected["NetworkSettings"]["Ports"].get("5432/tcp") or []
        if (inspected["Id"] != created_id or inspected["Config"]["Image"] != IMAGE or inspected["Image"] != IMAGE_ID or
            len(bindings) != 1 or bindings[0]["HostIp"] != "127.0.0.1" or bindings[0]["HostPort"] != str(port) or
            inspected["Mounts"] or inspected["HostConfig"].get("NanoCpus") != 2_000_000_000 or
            inspected["HostConfig"].get("Memory") != 536_870_912 or not inspected["HostConfig"].get("Tmpfs", {}).get("/var/lib/postgresql/data")):
            raise RuntimeError("disposable container failed exact loopback/CPU/memory/tmpfs/no-volume verification")
        run(["docker", "exec", created_id, "createdb", "-U", "postgres", "sdm_lifecycle_test"], timeout=10)
        run(["docker", "exec", created_id, "createuser", "-U", "postgres", "-s", "sdm_lifecycle_test"], timeout=10)
        # A synthetic representative pre-0044 state, no source .env/default DB migration command.
        for statement in BASELINE.read_text().split(";"):
            if statement.strip(): psql(statement, user="sdm_lifecycle_test", db="sdm_lifecycle_test")
        assert_query("SELECT count(*) FROM refresh_tokens WHERE token_hash=repeat('a',64)", "1")
        apply_breakpoints(MIGRATION)
        assert_query("SELECT count(*) FROM information_schema.columns WHERE table_name='refresh_tokens' AND column_name='session_id'", "1")
        assert_query("SELECT count(*) FROM refresh_tokens WHERE token_hash=repeat('a',64) AND session_id IS NULL", "1")
        apply_breakpoints(MIGRATION)  # Replay must remain safe.
        assert_query("SELECT count(*) FROM pg_indexes WHERE indexname IN ('browser_sessions_user_id_idx','browser_sessions_active_idx','refresh_tokens_session_id_idx')", "3")
        assert_query("SELECT count(*) FROM pg_constraint WHERE conrelid='refresh_tokens'::regclass AND confrelid='browser_sessions'::regclass AND contype='f'", "1")
        rollback_sql = ROLLBACK.read_text()
        subprocess.run(["docker", "exec", "-i", created_id, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "sdm_lifecycle_test", "-d", "sdm_lifecycle_test"], input=rollback_sql, text=True, cwd=API, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15, check=True)
        assert_query("SELECT count(*) FROM information_schema.tables WHERE table_name='browser_sessions'", "0")
        assert_query("SELECT count(*) FROM information_schema.columns WHERE table_name='refresh_tokens' AND column_name='session_id'", "0")
        assert_query("SELECT count(*) FROM pg_constraint WHERE conrelid='refresh_tokens'::regclass AND contype='f' AND pg_get_constraintdef(oid) ILIKE '%session_id%'", "0")
        assert_query("SELECT count(*) FROM pg_indexes WHERE indexname IN ('browser_sessions_user_id_idx','browser_sessions_active_idx','refresh_tokens_session_id_idx')", "0")
        assert_query("SELECT count(*) FROM refresh_tokens WHERE token_hash=repeat('a',64)", "1")
        apply_breakpoints(MIGRATION)
        assert_query("SELECT count(*) FROM information_schema.tables WHERE table_name='browser_sessions'", "1")
        assert_query("SELECT count(*) FROM information_schema.columns WHERE table_name='refresh_tokens' AND column_name='session_id'", "1")
        assert_query("SELECT count(*) FROM pg_indexes WHERE indexname IN ('browser_sessions_user_id_idx','browser_sessions_active_idx','refresh_tokens_session_id_idx')", "3")
        assert_query("SELECT count(*) FROM refresh_tokens WHERE token_hash=repeat('a',64) AND session_id IS NULL", "1")
        print("MIGRATION_REPLAY_ROLLBACK_REAPPLY=PASS; synthetic representative baseline; historical chain not run")
        env = ENV.copy()
        env.update({"SDM_BROWSER_SESSION_TEST_DATABASE_URL": url, "SDM_BROWSER_SESSION_TEST_CONTAINER_ID": inspected["Id"],
                    # Intentionally impossible fallback: the suite must use the verified opt-in only.
                    "DATABASE_URL": "postgresql://bogus:bogus@127.0.0.1:1/forbidden"})
        result = subprocess.run(["pnpm", "exec", "vitest", "run", "--config", "scripts/browser-session-vitest.config.ts",
                                 "src/services/browser-session-lifecycle.test.ts"], cwd=API, env=env, text=True)
        if result.returncode: raise RuntimeError(f"guarded PostgreSQL lifecycle suite failed with exit {result.returncode}")
    finally:
        if created_id:
            result = run(["docker", "inspect", created_id], check=False, timeout=3)
            if result.returncode == 0:
                leftover = json.loads(result.stdout)[0]
            elif "No such object" in (result.stderr or ""):
                leftover = None
            else:
                raise RuntimeError("could not verify owned container identity for cleanup")
            if leftover is not None and leftover.get("Id") != created_id:
                raise RuntimeError("owned name now points to an unexpected container; refusing to remove it")
            if leftover is not None:
                run(["docker", "rm", "--force", created_id], timeout=10)
                result = run(["docker", "inspect", created_id], check=False, timeout=3)
                if result.returncode == 0 or "No such object" not in (result.stderr or ""):
                    raise RuntimeError("owned disposable PostgreSQL container remained after cleanup")
            print("TEARDOWN=PASS; owned container absent; Docker run used no volumes")

if __name__ == "__main__":
    try: main()
    except Exception as exc:
        print(f"HARNESS_FAILURE={type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
