import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";

export type ConnectionExportDialogProps = {
  open: boolean;
  connectionCount: number;
  sshProfileCount: number;
  exporting: boolean;
  onClose: () => void;
  onConfirm: (payload: { password: string }) => void;
};

export function ConnectionExportDialog({
  open,
  connectionCount,
  sshProfileCount,
  exporting,
  onClose,
  onConfirm,
}: ConnectionExportDialogProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (!open) {
      setPassword("");
      setConfirmPassword("");
    }
  }, [open]);

  const passwordsMatch = password.trim() && password === confirmPassword;
  const hasValidExportPassword = connectionCount > 0 && Boolean(passwordsMatch);
  const canConfirm = hasValidExportPassword && !exporting;

  function handleConfirm() {
    if (!canConfirm) {
      return;
    }

    onConfirm({ password: password.trim() });
  }

  return (
    <Dialog
      open={open}
      title="导出连接"
      description={`将 ${connectionCount} 条连接和 ${sshProfileCount} 条关联 SSH 通道加密导出。`}
      onClose={onClose}
      panelClassName="max-w-xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={exporting}>
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!hasValidExportPassword}
            aria-disabled={exporting || undefined}
          >
            {exporting ? "导出中..." : "导出"}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 text-sm leading-6 text-slate-600">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
          导出文件包含 Elasticsearch 凭据和 SSH 凭据，请使用强密码保存，并只分享给可信设备。
        </div>

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
      </div>
    </Dialog>
  );
}
