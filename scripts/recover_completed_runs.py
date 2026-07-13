#!/usr/bin/env python3
"""Recover runs that completed in Plumber but are marked failed/running in the DB.

Usage:
  python3 scripts/recover_completed_runs.py            # real run
  python3 scripts/recover_completed_runs.py --dry-run   # preview only
"""
import json
import os
import subprocess
import sys

dry_run = "--dry-run" in sys.argv

JOBS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "outputs", "jobs")
PSQL = ["docker", "exec", "-i", "sdm-dashboard-main-postgres-1", "psql", "-U", "sdm", "-d", "sdm_platform"]


def psql(sql):
    result = subprocess.run(PSQL + ["-c", sql], capture_output=True, text=True)
    return result.stdout, result.stderr


def esc(val):
    """Escape a string for use inside a psql -c single-quoted SQL string."""
    if val is None:
        return "NULL"
    return "'" + val.replace("'", "''") + "'"


recovered = 0
skipped = 0

with os.scandir(JOBS_DIR) as it:
    for entry in it:
        if not entry.is_dir():
            continue
        meta_file = os.path.join(entry.path, "meta.json")
        if not os.path.isfile(meta_file):
            skipped += 1
            continue

        try:
            with open(meta_file) as f:
                meta = json.load(f)
        except (json.JSONDecodeError, OSError):
            skipped += 1
            continue

        if meta.get("status") != "completed":
            continue

        run_id = meta.get("config", {}).get("runId")
        if not run_id or not isinstance(run_id, str) or not run_id.strip():
            skipped += 1
            continue

        completed_at = meta.get("completed_at", "").replace("T", " ").replace("Z", "")
        if not completed_at:
            skipped += 1
            continue

        metrics = meta.get("metrics")
        output_files = meta.get("output_files")

        metrics_json = esc(json.dumps(metrics, ensure_ascii=False)) if metrics else "NULL"
        output_files_json = esc(json.dumps(output_files, ensure_ascii=False)) if output_files else "NULL"
        completed_at_esc = esc(completed_at)

        if dry_run:
            print(f"  Job: {entry.name}  RunId: {run_id}  Would recover from 'failed'/'running' → 'completed'")
            continue

        sql = (
            f"UPDATE runs SET "
            f"status = 'completed', "
            f"error = NULL, "
            f"error_code = NULL, "
            f"error_hint = NULL, "
            f"metrics = {metrics_json}::jsonb, "
            f"output_files = {output_files_json}::jsonb, "
            f"completed_at = {completed_at_esc}::timestamp "
            f"WHERE id = {esc(run_id)} AND status IN ('failed', 'running');"
        )

        stdout, stderr = psql(sql)

        if "UPDATE 1" in stdout:
            print(f"  RECOVERED: {entry.name} → RunId: {run_id}")
            recovered += 1
        elif "UPDATE 0" in stdout:
            print(f"  SKIPPED: {entry.name} (not in failed/running state or id not found)")
        else:
            print(f"  ERROR: {entry.name} — {stdout.strip()} {stderr.strip()}")


print(f"\nDone. Recovered: {recovered}  Skipped/irrelevant: {skipped}")
