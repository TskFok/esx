import { useEffect, useState } from "react";
import type { RequestImportMode } from "../../lib/request-import-export";
import type { RequestExportPayload } from "../../lib/request-import-export";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";

export type ConsoleImportDialogProps = {
  open: boolean;
  fileName: string;
  encrypted: boolean;
  payload: RequestExportPayload | null;
  connections: Array<{ id: string; name: string }>;
  defaultConnectionId: string;
  errorMessage: string | null;
  importing: boolean;
  onClose: () => void;
  onConfirm: (payload: {
    connectionId: string;
    mode: RequestImportMode;
    password: string;
  }) => void;
};

export function ConsoleImportDialog({
  open,
  fileName,
  encrypted,
  payload,
  connections,
  defaultConnectionId,
  errorMessage,
  importing,
  onClose,
  onConfirm,
}: ConsoleImportDialogProps) {
  const [connectionId, setConnectionId] = useState(defaultConnectionId);
  const [mode, setMode] = useState<RequestImportMode>("merge");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    setConnectionId(defaultConnectionId);
    setMode("merge");
    setPassword("");
  }, [defaultConnectionId, open]);

  const canConfirm = Boolean(connectionId) && (!encrypted || password.trim()) && !importing;

  return (
    <Dialog
      open={open}
      title="导入请求"
      description={`文件：${fileName}`}
      onClose={onClose}
      panelClassName="max-w-xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={importing}>
            取消
          </Button>
          <Button
            onClick={() => onConfirm({ connectionId, mode, password })}
            disabled={!canConfirm}
          >
            {importing ? "导入中..." : "开始导入"}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 text-sm leading-6 text-slate-600">
        {encrypted ? (
          <label className="block">
            <span className="mb-2 block font-semibold text-slate-700">导出密码</span>
            <Input
              type="password"
              autoFocus
              placeholder="输入加密导出时设置的密码"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        ) : null}

        {payload ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p>
              来源连接：<span className="font-semibold text-slate-800">{payload.connectionName}</span>
            </p>
            <p className="mt-1">
              请求数量：<span className="font-semibold text-slate-800">{payload.requests.length}</span>
            </p>
          </div>
        ) : encrypted ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-500">
            输入密码后将预览导入内容。
          </p>
        ) : null}

        <label className="block">
          <span className="mb-2 block font-semibold text-slate-700">导入到连接</span>
          <select
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800"
            value={connectionId}
            onChange={(event) => setConnectionId(event.target.value)}
          >
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="space-y-2">
          <legend className="mb-2 font-semibold text-slate-700">导入方式</legend>
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 px-4 py-3">
            <input
              type="radio"
              name="import-mode"
              checked={mode === "merge"}
              onChange={() => setMode("merge")}
              className="mt-1"
            />
            <span>
              <span className="block font-semibold text-slate-800">合并导入</span>
              <span className="text-slate-500">保留目标连接现有请求，在末尾追加导入内容。</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-rose-200 bg-rose-50/40 px-4 py-3">
            <input
              type="radio"
              name="import-mode"
              checked={mode === "replace"}
              onChange={() => setMode("replace")}
              className="mt-1"
            />
            <span>
              <span className="block font-semibold text-slate-800">替换导入</span>
              <span className="text-slate-500">删除目标连接下的全部请求，再写入导入内容。此操作不可恢复。</span>
            </span>
          </label>
        </fieldset>

        {errorMessage ? <p className="text-sm text-rose-600">{errorMessage}</p> : null}
      </div>
    </Dialog>
  );
}
