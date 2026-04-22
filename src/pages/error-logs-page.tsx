import { ArrowLeft, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Switch } from "../components/ui/switch";
import { formatShanghaiDateTime } from "../lib/time";
import { useAppState } from "../providers/app-state";

const scopeLabelMap = {
  "connection-save": "连接保存",
  "connection-test": "连接测试",
  "request-execution": "请求执行",
} as const;

export function ErrorLogsPage() {
  const navigate = useNavigate();
  const { errorLoggingEnabled, setErrorLoggingEnabled, clearErrorLogs, errorLogs, currentConnection } = useAppState();

  return (
    <div className="min-h-screen bg-hero-grid px-4 py-8 sm:px-8" onContextMenu={(event) => event.preventDefault()}>
      <div className="mx-auto max-w-6xl space-y-6">
        <Card className="p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-emerald-600">诊断与排错</p>
              <h1 className="mt-2 text-3xl font-extrabold text-slate-900">错误日志</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-500">
                仅在开启“收集错误日志”后，连接失败和请求失败才会被写入本地日志。日志会记录连接信息、请求上下文和底层诊断链路，便于定位 SSH 与 Elasticsearch 的问题。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={() => navigate(currentConnection ? "/console" : "/connections")}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回
              </Button>
              <Button variant="ghost" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={clearErrorLogs}>
                <Trash2 className="mr-2 h-4 w-4" />
                清空日志
              </Button>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-cyan-100 bg-cyan-50/80 p-4">
            <div>
              <p className="text-sm font-semibold text-cyan-950">收集错误日志</p>
              <p className="mt-1 text-sm leading-7 text-cyan-900">
                关闭时不会新增任何日志；已存在的日志会保留，直到你手动清空。
              </p>
            </div>
            <Switch checked={errorLoggingEnabled} onChange={(event) => setErrorLoggingEnabled(event.target.checked)} />
          </div>
        </Card>

        {errorLogs.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-base font-bold text-slate-900">当前还没有错误日志</p>
            <p className="mt-2 text-sm leading-7 text-slate-500">
              {errorLoggingEnabled ? "日志采集已开启，后续连接或请求失败时会记录在这里。" : "先开启日志采集，之后再复现问题。"}
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {errorLogs.map((log) => (
              <Card key={log.id} className="p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-700">
                        {scopeLabelMap[log.scope]}
                      </span>
                      {typeof log.status === "number" && log.status > 0 ? (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-700">
                          {log.status}
                        </span>
                      ) : null}
                    </div>
                    <h2 className="mt-3 text-xl font-bold text-slate-900">{log.title}</h2>
                    <p className="mt-2 text-sm leading-7 text-slate-600">{log.summary}</p>
                  </div>

                  <p className="text-xs text-slate-400">{formatShanghaiDateTime(log.createdAt)}</p>
                </div>

                {log.connection ? (
                  <div className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50/80 p-4 text-sm leading-7 text-slate-600">
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
                  <div className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50/80 p-4 text-sm leading-7 text-slate-600">
                    <p>
                      请求：{log.request.method ?? "未知方法"} {log.request.path ?? ""}
                    </p>
                    {log.request.content ? (
                      <pre className="mt-3 overflow-x-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                        {log.request.content}
                      </pre>
                    ) : null}
                  </div>
                ) : null}

                {log.diagnostics.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-sm font-semibold text-slate-900">错误链路</p>
                    <pre className="mt-3 overflow-x-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                      {log.diagnostics.join("\n\n")}
                    </pre>
                  </div>
                ) : null}

                {log.rawResponse ? (
                  <div className="mt-4">
                    <p className="text-sm font-semibold text-slate-900">原始返回</p>
                    <pre className="mt-3 overflow-x-auto rounded-2xl bg-slate-100 p-4 text-xs leading-6 text-slate-700">
                      {log.rawResponse}
                    </pre>
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
