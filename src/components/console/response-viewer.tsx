import type { ResponseSnapshot } from "../../types/requests";
import { formatBytes } from "../../lib/utils";
import { getResponseDisplayText } from "../../lib/response-snapshot";
import { LazyConsoleEditor } from "./lazy-console-editor";

type ResponseViewerProps = {
  response: ResponseSnapshot | null;
  fallbackValue: string;
};

export function ResponseViewer({ response, fallbackValue }: ResponseViewerProps) {
  if (!response) {
    return <LazyConsoleEditor readOnly value={fallbackValue} onChange={() => {}} />;
  }

  const value = getResponseDisplayText(response);

  if (response.previewEvicted) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-900">
        历史预览已清理。再次执行请求可生成新预览。
      </div>
    );
  }

  if (!response.truncated) {
    return <LazyConsoleEditor readOnly value={value} onChange={() => {}} />;
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
