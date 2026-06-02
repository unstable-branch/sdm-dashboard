import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";

const errorRate = new Rate("errors");
const sdmduration = new Trend("sdm_run_duration", true);

export const options = {
  scenarios: {
    admin_api: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "30s", target: 5 },
        { duration: "1m", target: 10 },
        { duration: "30s", target: 1 },
      ],
      gracefulRampDown: "10s",
    },
    public_api: {
      executor: "constant-vus",
      vus: 5,
      duration: "1m",
    },
    health_check: {
      executor: "constant-vus",
      vus: 2,
      duration: "2m",
    },
  },
  thresholds: {
    "http_req_duration{scenario: health_check}": ["p(95)<1000"],
    "errors": ["rate<0.1"],
  },
};

const BASE_URL = __ENV.API_URL || "http://localhost:4000";
const JWT_TOKEN = __ENV.JWT_TOKEN || "";

function authHeaders() {
  if (JWT_TOKEN) {
    return {
      Authorization: `Bearer ${JWT_TOKEN}`,
      "Content-Type": "application/json",
    };
  }
  return { "Content-Type": "application/json" };
}

export function healthCheck() {
  const res = http.get(`${BASE_URL}/health`);
  check(res, {
    "health status 200": function (r) { return r.status === 200; },
    "health body has status ok": function (r) {
      try {
        const body = JSON.parse(String(r.body));
        return body.status === "ok";
      } catch (_) {
        return false;
      }
    },
  });
  errorRate.add(res.status >= 400);
  sleep(0.5);

  const ready = http.get(`${BASE_URL}/ready`);
  check(ready, {
    "ready responds": function (r) { return r.status === 200 || r.status === 503; },
  });
  errorRate.add(ready.status >= 500);
}

export function publicApi() {
  var endpoints = [
    `${BASE_URL}/api/v1/climate/scenarios`,
    `${BASE_URL}/api/v1/models`,
    `${BASE_URL}/api/v1/config/defaults`,
    `${BASE_URL}/api/v1/models/runs`,
  ];

  for (var i = 0; i < endpoints.length; i++) {
    var url = endpoints[i];
    var res = http.get(url);
    var label = url.split("/").pop() || "unknown";
    check(res, {
      ["public " + label + " ok"]: function (r) { return r.status < 500; },
    });
    errorRate.add(res.status >= 400);
    sleep(1);
  }
}

export function adminApi() {
  var endpoints = [
    `${BASE_URL}/api/v1/admin/overview`,
    `${BASE_URL}/api/v1/admin/users`,
    `${BASE_URL}/api/v1/admin/logs`,
    `${BASE_URL}/api/v1/admin/system/settings`,
    `${BASE_URL}/api/v1/admin/diagnostics/runs`,
  ];

  var headers = authHeaders();

  for (var i = 0; i < endpoints.length; i++) {
    var url = endpoints[i];
    var res = http.get(url, { headers: headers });
    var label = url.split("/").pop() || "unknown";
    check(res, {
      ["admin " + label + " status"]: function (r) { return r.status === 200 || r.status === 401; },
    });
    errorRate.add(res.status >= 500);
    sleep(0.5);
  }
}

export default function () {
  group("health_check", function () { healthCheck(); });
}