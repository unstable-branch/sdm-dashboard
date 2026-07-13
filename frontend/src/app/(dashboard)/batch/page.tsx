"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function BatchPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/data?tab=batch");
  }, [router]);
  return null;
}
