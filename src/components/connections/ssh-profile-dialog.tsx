import { Loader2 } from "lucide-react";
import type { SshProfileFormValues } from "../../types/connections";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";

export type SshProfileDialogProps = {
  open: boolean;
  title: string;
  values: SshProfileFormValues;
  saving: boolean;
  incomplete: boolean;
  onClose: () => void;
  onChange: (next: SshProfileFormValues) => void;
  onSave: () => void;
};

export function SshProfileDialog({
  open,
  title,
  values,
  saving,
  incomplete,
  onClose,
  onChange,
  onSave,
}: SshProfileDialogProps) {
  function handleClose() {
    if (saving) {
      return;
    }
    onClose();
  }

  return (
    <Dialog
      open={open}
      title={title}
      description="这里只验证 SSH 主机本身是否可连通以及认证方式是否正确。保存成功后，ES 连接就可以复用这条已保存 SSH 通道。"
      onClose={handleClose}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={onSave} disabled={saving || incomplete}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            验证并保存 SSH 通道
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">SSH 通道名称</span>
          <Input
            placeholder="例如 生产跳板机 / 测试堡垒机"
            value={values.name}
            onChange={(event) => onChange({ ...values, name: event.target.value })}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">SSH 主机</span>
          <Input
            placeholder="bastion.example.com"
            value={values.sshHost}
            onChange={(event) => onChange({ ...values, sshHost: event.target.value })}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">SSH 端口</span>
          <Input
            type="number"
            min="1"
            max="65535"
            placeholder="22"
            value={values.sshPort}
            onChange={(event) => onChange({ ...values, sshPort: event.target.value })}
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">SSH 用户名</span>
          <Input
            placeholder="ubuntu / root / deploy"
            value={values.sshUsername}
            onChange={(event) => onChange({ ...values, sshUsername: event.target.value })}
          />
        </label>

        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">SSH 认证方式</span>
          <div className="flex flex-wrap gap-1">
            <Button
              variant={values.sshAuthMethod === "password" ? "default" : "outline"}
              className="h-8 rounded-lg px-2.5 text-xs"
              onClick={() => onChange({ ...values, sshAuthMethod: "password" })}
            >
              密码
            </Button>
            <Button
              variant={values.sshAuthMethod === "privateKey" ? "default" : "outline"}
              className="h-8 rounded-lg px-2.5 text-xs"
              onClick={() => onChange({ ...values, sshAuthMethod: "privateKey" })}
            >
              私钥
            </Button>
          </div>
        </div>

        {values.sshAuthMethod === "password" ? (
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">SSH 密码</span>
            <Input
              type="password"
              placeholder="请输入 SSH 密码"
              value={values.sshPassword}
              onChange={(event) => onChange({ ...values, sshPassword: event.target.value })}
            />
          </label>
        ) : (
          <>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">SSH 私钥路径</span>
              <Input
                placeholder="~/.ssh/id_rsa"
                value={values.sshPrivateKeyPath}
                onChange={(event) => onChange({ ...values, sshPrivateKeyPath: event.target.value })}
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">私钥口令（可选）</span>
              <Input
                type="password"
                placeholder="如果私钥有口令，请在这里填写"
                value={values.sshPassphrase}
                onChange={(event) => onChange({ ...values, sshPassphrase: event.target.value })}
              />
            </label>
          </>
        )}
      </div>
    </Dialog>
  );
}
