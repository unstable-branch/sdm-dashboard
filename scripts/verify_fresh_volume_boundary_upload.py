#!/usr/bin/env python3
"""Fresh-volume custom-boundary upload/resolve regression (platform CI).

Drives the public canonical boundary workflow — register, login, then
POST /api/v1/data/boundary/upload followed by
GET /api/v1/data/boundary/default?type=custom — against the real built
Compose stack shortly after its named volumes were created.

Catches the deployment defect where a fresh boundary volume stays root-owned,
so the unprivileged producer cannot create its storage directory and the
upload fails closed with 500 {"error":"Custom boundary storage is unsafe"}.

It also guards the resolve path: a boundary the API just registered must read
back as GeoJSON, which exercises the API asset hash revalidation plus the
Plumber content reader in one pass.

The check is credential-free: it uses a deterministic synthetic registration
(the CI stack's database is disposable), the same trust model as the
Playwright smoke above it. Any 5xx from the boundary producer, or any
response lacking a boundaryAssetId / GeoJSON body, fails the build.

Only synthetic data is used; nothing is written outside the CI stack.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

SYNTHETIC_GEOJSON = (
    '{"type":"FeatureCollection","features":[{"type":"Feature",'
    '"properties":{"name":"ci-fresh-volume-regression"},'
    '"geometry":{"type":"Polygon","coordinates":[[[100.0,-1.0],'
    '[101.0,-1.0],[101.0,0.0],[100.0,0.0],[100.0,-1.0]]]}}]}'
)


def request(method, url, headers=None, data=None):
    req = urllib.request.Request(url, method=method, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def post_json(base_url, path, payload, token=None):
    headers = {"Content-Type": "application/json", "Origin": base_url}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    status, body = request("POST", base_url + path, headers, json.dumps(payload).encode())
    try:
        return status, json.loads(body)
    except json.JSONDecodeError:
        return status, {"raw": body.decode("utf-8", "replace")}


def wait_for_api(base_url, attempts=60, delay=5):
    for attempt in range(1, attempts + 1):
        try:
            status, _ = request("GET", base_url + "/health")
            if status == 200:
                print(f"api healthy after ~{(attempt - 1) * delay}s")
                return
        except urllib.error.URLError:
            pass
        time.sleep(delay)
    raise SystemExit("FAIL: api did not become healthy")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:4000")
    args = parser.parse_args()

    wait_for_api(args.base_url)

    email = f"ci-boundary-{int(time.time())}@example.test"
    password = "Ci-Boundary-Regression-2026!"

    status, body = post_json(
        args.base_url,
        "/api/v1/auth/register",
        {"email": email, "password": password, "name": "CI Boundary Regression"},
    )
    if status not in (200, 201) or not body.get("token"):
        raise SystemExit(f"FAIL: registration failed ({status}): {json.dumps(body)[:300]}")
    token = body["token"]
    print("registered synthetic owner and obtained access token")

    boundary = SYNTHETIC_GEOJSON.encode()
    form = (
        f"--ci-boundary\r\n"
        f'Content-Disposition: form-data; name="file"; filename="ci_fresh_volume.geojson"\r\n'
        f"Content-Type: application/geo+json\r\n\r\n"
    ).encode() + boundary + b"\r\n--ci-boundary--\r\n"

    status, body = request(
        "POST",
        args.base_url + "/api/v1/data/boundary/upload",
        {
            "Authorization": f"Bearer {token}",
            "Origin": args.base_url,
            "Content-Type": "multipart/form-data; boundary=ci-boundary",
        },
        form,
    )
    detail = body.decode("utf-8", "replace")
    if status == 500 and "Custom boundary storage is unsafe" in detail:
        raise SystemExit(
            "FAIL RED: fresh-volume boundary upload hit the root-owned boundary "
            "volume defect (500 Custom boundary storage is unsafe). The plumber "
            "entrypoint in this image does not normalize /app/data/boundaries."
        )
    try:
        parsed = json.loads(detail)
    except json.JSONDecodeError:
        parsed = None
    if status != 200 or not isinstance(parsed, dict) or not parsed.get("boundaryAssetId"):
        # The API wraps producer failures, so the storage error is usually
        # reported as a generic 502; name the fresh-volume class explicitly
        # because this check runs on a just-created stack.
        hint = ""
        if status in (500, 502):
            hint = (
                "\nA 5xx on a fresh stack usually means the boundary volume is "
                "still root-owned: the plumber entrypoint must normalize "
                "/app/data/boundaries before dropping privileges."
            )
        raise SystemExit(
            f"FAIL: boundary upload returned {status}: "
            f"{detail if parsed is None else json.dumps(parsed)[:300]}{hint}"
        )
    asset_id = parsed["boundaryAssetId"]
    print(f"GREEN: fresh-volume boundary upload succeeded, boundaryAssetId={asset_id}")

    # Resolve the boundary just registered: the JSON body must round-trip.
    resolve_url = (
        f"{args.base_url}/api/v1/data/boundary/default"
        f"?type=custom&resolution=110m&boundaryAssetId={asset_id}"
    )
    status, body = request("GET", resolve_url, {"Authorization": f"Bearer {token}"})
    detail = body.decode("utf-8", "replace")
    try:
        resolved = json.loads(detail)
    except json.JSONDecodeError:
        resolved = detail
    if status != 200 or not isinstance(resolved, dict) or resolved.get("type") != "FeatureCollection":
        raise SystemExit(
            f"FAIL: boundary resolve returned {status}: {str(resolved)[:300]}"
        )
    print("GREEN: fresh-volume boundary resolve returned GeoJSON FeatureCollection")


if __name__ == "__main__":
    sys.exit(main())
