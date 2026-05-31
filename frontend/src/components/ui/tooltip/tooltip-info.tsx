import { Info } from "lucide-react";
import { TooltipRoot, TooltipTrigger, TooltipContent } from "./tooltip";

interface TooltipInfoProps {
  content?: string;
  children?: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}

export function TooltipInfo({ content, children, side = "top" }: TooltipInfoProps) {
  return (
    <TooltipRoot>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center cursor-help">
          <Info className="h-3.5 w-3.5 text-sdm-muted hover:text-sdm-text shrink-0" />
        </span>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-xs leading-relaxed">
        {content || children}
      </TooltipContent>
    </TooltipRoot>
  );
}
