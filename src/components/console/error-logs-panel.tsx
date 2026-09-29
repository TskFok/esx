import { PanelRightClose, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { getErrorLogScopeLabel, getErrorLogsEmptyDescription } from "../../lib/error-log-display";
import { formatShanghaiDateTime } from "../../lib/time";
import { useAppActions, useAppStateField } from "../../providers/app-state";
import type { ErrorLogEntry } from "../../types/logs";

export type ErrorLogsPanelProps = {
  onClose: () => void;
  closeTitle?: string;
  className?: string;
};

function ErrorLogItem({ log }: { log: ErrorLogEntry }) {
  return (
    <article className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              {getErrorLogScopeLabel(log.scope)}
            </span>
            {typeof log.status === "number" && log.status > 0 ? (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                {log.status}
              </span>
            ) : null}
          </div>
          <h2 className="mt-1.5 text-sm font-semibold leading-snug text-slate-900">{log.title}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">{log.summary}</p>
        </div>
        <p className="shrink-0 text-[11px] text-slate-400">{formatShanghaiDateTime(log.createdAt)}</p>
      </div>

      {log.connection ? (
        <div className="mt-2 rounded border border-slate-200 bg-background p-2 text-xs leading-5 text-slate-600">
          {log.connection.baseUrl ? (
            <p>
              连接：{log.connection.name ? `${log.connection.name} · ` : ""}
              {log.connection.baseUrl}
            </p>
          ) : log.connection.name ? (
            <p>名称：{log.connection.name}</p>
          ) : null}
          {log.connection.username ? <p>用户名：{log.connection.username}</p> : null}
          {log.connection.sshTunnelEnabled ? (
            <p>
              SSH：{log.connection.sshUsername}@{log.connection.sshHost}:{log.connection.sshPort}
              {log.connection.sshAuthMethod ? ` · ${log.connection.sshAuthMethod === "password" ? "密码" : "私钥"}` : ""}
            </p>
          ) : (
            <p>SSH：未启用</p>
          )}
        </div>
      ) : null}

      {log.request ? (
        <div className="mt-2 rounded border border-slate-200 bg-background p-2 text-xs leading-5 text-slate-600">
          <p>
            请求：{log.request.method ?? "未知方法"} {log.request.path ?? ""}
          </p>
          {log.request.content ? (
            <pre className="mt-2 overflow-x-auto rounded bg-slate-950 p-2 text-[11px] leading-5 text-slate-100">
              {log.request.content}
            </pre>
          ) : null}
        </div>
      ) : null}

      {log.diagnostics.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs font-semibold text-slate-900">错误链路</p>
          <pre className="mt-1 overflow-x-auto rounded bg-slate-950 p-2 text-[11px] leading-5 text-slate-100">
            {log.diagnostics.join("\n\n")}
          </pre>
        </div>
      ) : null}

      {log.rawResponse ? (
        <div className="mt-2">
          <p className="text-xs font-semibold text-slate-900">原始返回</p>
          <pre className="mt-1 overflow-x-auto rounded bg-background p-2 text-[11px] leading-5 text-slate-700">
            {log.rawResponse}
          </pre>
        </div>
      ) : null}
    </article>
  );
}

export function ErrorLogsPanel({
  onClose,
  closeTitle = "关闭错误日志",
  className = "flex h-full min-h-0 flex-col overflow-hidden",
}: ErrorLogsPanelProps) {
  const errorLoggingEnabled = useAppStateField("errorLoggingEnabled");
  const errorLogs = useAppStateField("errorLogs");
  const { setErrorLoggingEnabled, clearErrorLogs } = useAppActions();

  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="min-w-0">
          <h1 className="section-title">错误日志</h1>
          <p className="mt-1 text-xs text-slate-500">诊断与排错</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 px-2 text-xs"
          title={closeTitle}
          aria-label={closeTitle}
          onClick={onClose}
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-3 rounded-md border border-slate-200 bg-background p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 pr-2">
            <p className="text-xs font-semibold text-slate-900">收集诊断日志</p>
            <p className="mt-0.5 text-[11px] leading-5 text-slate-600">
              关闭时不会新增失败诊断；审计日志仍会记录成功的写入或管理操作。
            </p>
          </div>
          <Switch
            checked={errorLoggingEnabled}
            aria-label="收集诊断日志"
            onChange={(event) => setErrorLoggingEnabled(event.target.checked)}
          />
        </div>
      </div>

      <div className="mt-2 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="px-2 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          onClick={clearErrorLogs}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          清空日志
        </Button>
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-0.5">
        {errorLogs.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 bg-white p-6 text-center">
            <p className="text-sm font-semibold text-slate-900">当前还没有日志</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{getErrorLogsEmptyDescription(errorLoggingEnabled)}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {errorLogs.map((log) => (
              <ErrorLogItem key={log.id} log={log} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
