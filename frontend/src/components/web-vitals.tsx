"use client";

import { useReportWebVitals } from "next/web-vitals";

export function WebVitals() {
  useReportWebVitals((metric) => {
    console.log("[web-vitals]", metric.name, metric.value);
    // Send to analytics in production:
    // const body = JSON.stringify(metric);
    // navigator.sendBeacon("/api/analytics", body);
  });
  return null;
}
