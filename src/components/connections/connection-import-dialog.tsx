import { useEffect, useState } from "react";
import type { ConnectionExportPayload } from "../../lib/connection-import-export";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";

export type ConnectionImportDialogProps = {
  open: boolean;
  fileName: string;
  payload: ConnectionExportPayload | null;
  errorMessage: string | null;
  parsing: boolean;
  importing: boolean;
  onClose: () => void;
  onParse: (password: string) => void;
  onConfirm: () => void;
};

export function ConnectionImportDialog({
  open,
  fileName,
  payload,
  errorMessage,
  parsing,
  importing,
  onClose,
  onParse,
  onConfirm,
}: ConnectionImportDialogProps) {
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (open) {
      setPassword("");
    }
  }, [open, fileName]);

  const busy = parsing || importing;
  const canParse = Boolean(password.trim()) && !busy;
  const canImport = Boolean(payload) && !busy;

  return (
    <Dialog
      open={open}
      title="导入连接"
      description={`文件：${fileName}`}
      onClose={onClose}
      panelClassName="max-w-xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          {payload ? (
            <Button onClick={onConfirm} disabled={!canImport}>
              {importing ? "导入中..." : "开始导入"}
            </Button>
          ) : (
            <Button onClick={() => onParse(password)} disabled={!canParse}>
              {parsing ? "解析中..." : "解析文件"}
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-5 text-sm leading-6 text-slate-600">
        <label className="block">
          <span className="mb-2 block font-semibold text-slate-700">导出密码</span>
          <Input
            type="password"
            autoFocus
            placeholder="输入加密导出时设置的密码"
            value={password}
            disabled={Boolean(payload)}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {payload ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-950">
            <p>
              连接数量：<span className="font-semibold">{payload.connections.length}</span>
            </p>
            <p className="mt-1">
              SSH 通道数量：<span className="font-semibold">{payload.sshProfiles.length}</span>
            </p>
            <p className="mt-1">
              导出时间：<span className="font-semibold">{payload.exportedAt}</span>
            </p>
          </div>
        ) : (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-500">
            输入密码后先解析文件，预览数量无误后再写入本机连接。
          </p>
        )}

        {errorMessage ? <p className="text-sm text-rose-600">{errorMessage}</p> : null}
      </div>
    </Dialog>
  );
}
