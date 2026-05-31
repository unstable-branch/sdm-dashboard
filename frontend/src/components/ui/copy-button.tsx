"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  value: string | object;
  label?: string;
  size?: "sm" | "icon";
  variant?: "ghost" | "outline" | "default";
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}

export function CopyButton({
  value,
  label,
  size = "sm",
  variant = "ghost",
  className,
  onClick,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    onClick?.(e);
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [value, onClick]);

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleCopy}
      className={cn("shrink-0", className)}
      title={copied ? "Copied!" : label || "Copy to clipboard"}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {label && <span className="ml-1.5">{copied ? "Copied!" : label}</span>}
    </Button>
  );
}
