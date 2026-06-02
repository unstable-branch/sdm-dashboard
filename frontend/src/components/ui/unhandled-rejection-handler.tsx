"use client";

import { useEffect } from "react";

export function UnhandledRejectionHandler() {
  useEffect(() => {
    const handler = (event: PromiseRejectionEvent) => {
      const msg = event.reason instanceof Error ? event.reason.message : String(event.reason ?? "");
      if (
        msg.includes("ioredis") ||
        msg.includes("ECONNREFUSED") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ENOTFOUND") ||
        msg.includes("Connection is closed") ||
        msg.includes("fetch") ||
        msg.includes("network") ||
        msg.includes("NetworkError") ||
        msg.includes("AbortError") ||
        msg.includes("TimeoutError")
      ) {
        event.preventDefault();
        return;
      }
      console.error("[UnhandledRejection]", event.reason);
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);

  return null;
}
