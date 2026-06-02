import { ChevronRight } from "lucide-react";
import type { ConsoleContextBreadcrumbSegment } from "../../lib/console-sidebar";

type ConsoleContextBreadcrumbProps = {
  segments: ConsoleContextBreadcrumbSegment[];
  onSegmentClick: (segment: ConsoleContextBreadcrumbSegment) => void;
};

export function ConsoleContextBreadcrumb({ segments, onSegmentClick }: ConsoleContextBreadcrumbProps) {
  return (
    <nav aria-label="当前上下文" className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-slate-500">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;

        return (
          <span key={`${segment.kind}-${segment.label}-${index}`} className="flex min-w-0 items-center gap-1">
            {index > 0 ? <ChevronRight className="h-3 w-3 shrink-0 text-slate-300" aria-hidden /> : null}
            <button
              type="button"
              className={`truncate rounded-md px-1 py-0.5 transition hover:bg-slate-100 hover:text-slate-700 ${
                isLast ? "font-semibold text-slate-700" : "text-slate-500"
              }`}
              title={`定位到${segment.label}`}
              onClick={() => onSegmentClick(segment)}
            >
              {segment.label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
