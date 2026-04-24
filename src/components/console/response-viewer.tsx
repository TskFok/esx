import type { ResponseSnapshot } from "../../types/requests";
import { formatBytes } from "../../lib/utils";
import { getResponseDisplayText } from "../../lib/response-snapshot";
import { ConsoleEditor } from "./console-editor";

type ResponseViewerProps = {
  response: ResponseSnapshot | null;
  fallbackValue: string;
};

export function ResponseViewer({ response, fallbackValue }: ResponseViewerProps) {
  if (!response) {
    return <ConsoleEditor readOnly value={fallbackValue} onChange={() => {}} />;
  }

  const value = getResponseDisplayText(response);

  if (!response.truncated) {
    return <ConsoleEditor readOnly value={value} onChange={() => {}} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/60">
      <div className="border-b border-amber-200 px-4 py-3 text-xs font-semibold text-amber-900">
        已截断，显示前 {formatBytes(response.previewBytes)} / 原始大小 {formatBytes(response.sizeBytes)}
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 text-slate-800">
        {value}
      </pre>
    </div>
  );
}
