import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";

export type ConsoleExportDialogProps = {
  open: boolean;
  connectionName: string;
  requestCount: number;
  exporting: boolean;
  onClose: () => void;
  onConfirm: (payload: { encrypt: boolean; password: string }) => void;
};

export function ConsoleExportDialog({
  open,
  connectionName,
  requestCount,
  exporting,
  onClose,
  onConfirm,
}: ConsoleExportDialogProps) {
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (!open) {
      setEncrypt(false);
      setPassword("");
      setConfirmPassword("");
    }
  }, [open]);

  const passwordsMatch = !encrypt || (password.trim() && password === confirmPassword);
  const canConfirm = requestCount > 0 && passwordsMatch && !exporting;

  return (
    <Dialog
      open={open}
      title="导出请求"
      description={`将连接“${connectionName}”下的 ${requestCount} 条请求导出为 JSON 文件。`}
      onClose={onClose}
      panelClassName="max-w-xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={exporting}>
            取消
          </Button>
          <Button
            onClick={() => onConfirm({ encrypt, password: password.trim() })}
            disabled={!canConfirm}
          >
            {exporting ? "导出中..." : "导出"}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 text-sm leading-6 text-slate-600">
        <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
          <div>
            <p className="font-semibold text-slate-800">加密导出</p>
            <p className="mt-1 text-slate-500">使用 AES-GCM 加密文件内容，适合包含敏感请求体的环境。</p>
          </div>
          <Switch checked={encrypt} onChange={(event) => setEncrypt(event.target.checked)} />
        </div>

        {encrypt ? (
          <>
            <label className="block">
              <span className="mb-2 block font-semibold text-slate-700">导出密码</span>
              <Input
                type="password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-2 block font-semibold text-slate-700">确认密码</span>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            {password && confirmPassword && password !== confirmPassword ? (
              <p className="text-sm text-rose-600">两次输入的密码不一致。</p>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
