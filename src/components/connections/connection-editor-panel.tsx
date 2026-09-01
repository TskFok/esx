import { CirclePlus, Loader2, Pencil, ShieldAlert, Trash2, Zap } from "lucide-react";
import type { ConnectionEditorMode } from "../../lib/connection-form";
import type { ConnectionFormValues, SshProfile } from "../../types/connections";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";

export type ConnectionEditorPanelProps = {
  mode: ConnectionEditorMode;
  values: ConnectionFormValues;
  sshProfiles: SshProfile[];
  selectedSshProfile: SshProfile | null;
  saving: boolean;
  incomplete: boolean;
  testingSshProfileId: string | null;
  onCreate: () => void;
  onCancel: () => void;
  onSave: () => void;
  onChange: (next: ConnectionFormValues) => void;
  onCreateSsh: () => void;
  onEditSsh: (profile: SshProfile) => void;
  onTestSsh: (profile: SshProfile) => void;
  onDeleteSsh: (profile: SshProfile) => void;
};

export function ConnectionEditorPanel({
  mode,
  values,
  sshProfiles,
  selectedSshProfile,
  saving,
  incomplete,
  testingSshProfileId,
  onCreate,
  onCancel,
  onSave,
  onChange,
  onCreateSsh,
  onEditSsh,
  onTestSsh,
  onDeleteSsh,
}: ConnectionEditorPanelProps) {
  if (mode === "idle") {
    return (
      <Card className="flex h-full min-h-0 flex-col items-center justify-center p-8 text-center">
        <p className="text-sm leading-6 text-slate-600">选择左侧连接进入 Console，或新建一条连接。</p>
        <Button className="mt-4" onClick={onCreate}>
          <CirclePlus className="mr-1 h-4 w-4" />
          新建连接
        </Button>
      </Card>
    );
  }

  const testingSelectedSsh = Boolean(selectedSshProfile && testingSshProfileId === selectedSshProfile.id);

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden p-6 sm:p-8">
      <div className="shrink-0">
        <h2 className="text-2xl font-extrabold text-slate-900">{mode === "edit" ? "编辑连接" : "新增连接"}</h2>
        <p className="mt-2 text-sm leading-7 text-slate-500">连接直接保存为独立项。SSH 通道可选填。</p>
      </div>

      <div className="mt-6 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2 rounded-xl border border-emerald-100 bg-emerald-50/80 p-2.5">
            <div className="text-xs font-semibold text-emerald-950">保存方式</div>
            <p className="mt-1 text-xs leading-5 text-emerald-900 sm:text-sm">
              连接不再区分项目和模块，保存后即可直接在这里切换或进入 Console。
            </p>
          </div>

          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">连接名称</span>
            <Input
              placeholder="例如 生产 ES / 预发日志集群"
              value={values.name}
              onChange={(event) => onChange({ ...values, name: event.target.value })}
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">Elasticsearch 地址</span>
            <Input
              placeholder={selectedSshProfile ? "http://10.0.0.12:9200" : "https://your-es-host:9200"}
              value={values.baseUrl}
              onChange={(event) => onChange({ ...values, baseUrl: event.target.value })}
            />
            <p className="mt-1 text-[11px] leading-4 text-slate-500 sm:text-xs sm:leading-5">
              {selectedSshProfile
                ? "已选择 SSH 通道时，这里仍然填写 Elasticsearch 的内网 HTTP 地址，例如 `http://10.0.0.12:9200`。"
                : "例如 `https://es.example.com:9200`。如果填写的是 Kibana 页面地址，登录校验会返回 404 或网页内容。"}
            </p>
          </label>

          <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-white p-2.5">
            <p className="text-xs font-semibold text-slate-900 sm:text-sm">认证方式</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {(["basic", "apiKey", "bearer"] as const).map((authType) => (
                <Button
                  key={authType}
                  variant={values.authType === authType ? "default" : "outline"}
                  className="h-8 rounded-lg px-2.5 text-xs"
                  onClick={() => onChange({ ...values, authType })}
                >
                  {authType === "basic" ? "Basic" : authType === "apiKey" ? "API Key" : "Bearer"}
                </Button>
              ))}
            </div>
          </div>

          {values.authType === "basic" ? (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">Elasticsearch 用户名</span>
                <Input
                  placeholder="elastic"
                  value={values.username}
                  onChange={(event) => onChange({ ...values, username: event.target.value })}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">Elasticsearch 密码</span>
                <Input
                  type="password"
                  placeholder="请输入密码"
                  value={values.password}
                  onChange={(event) => onChange({ ...values, password: event.target.value })}
                />
              </label>
            </>
          ) : values.authType === "apiKey" ? (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">API Key</span>
              <Input
                type="password"
                placeholder="请输入 Elasticsearch API Key"
                value={values.apiKey}
                onChange={(event) => onChange({ ...values, apiKey: event.target.value })}
              />
            </label>
          ) : (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">Bearer Token</span>
              <Input
                type="password"
                placeholder="请输入 Bearer Token"
                value={values.bearerToken}
                onChange={(event) => onChange({ ...values, bearerToken: event.target.value })}
              />
            </label>
          )}

          <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-white p-2.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-slate-900 sm:text-sm">环境与写入保护</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">生产环境会对危险操作启用更严格确认；只读连接会阻断写入请求。</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600">只读</span>
                <Switch
                  checked={values.readonly}
                  onChange={(event) => onChange({ ...values, readonly: event.target.checked })}
                />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {(["dev", "test", "staging", "prod"] as const).map((environment) => (
                <Button
                  key={environment}
                  variant={values.environment === environment ? "default" : "outline"}
                  className="h-8 rounded-lg px-2.5 text-xs"
                  onClick={() => onChange({ ...values, environment })}
                >
                  {environment === "prod" ? "生产" : environment === "staging" ? "预发" : environment === "test" ? "测试" : "开发"}
                </Button>
              ))}
            </div>
          </div>

          <div className="sm:col-span-2 rounded-xl border border-cyan-100 bg-cyan-50/80 p-2.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="pr-2">
                <div className="text-xs font-semibold text-cyan-950 sm:text-sm">访问方式</div>
                <p className="mt-1 text-xs leading-5 text-cyan-900 sm:text-sm">
                  直连时不经过 SSH。若 Elasticsearch 只能从服务器内网访问，请先选择一条已保存 SSH 通道。
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button
                  variant={!values.sshProfileId ? "default" : "outline"}
                  className="h-8 rounded-lg px-2.5 text-xs"
                  onClick={() => onChange({ ...values, sshProfileId: "" })}
                >
                  直连
                </Button>
                <Button variant="outline" className="h-8 rounded-lg px-2.5 text-xs" onClick={onCreateSsh}>
                  <CirclePlus className="mr-1 h-3.5 w-3.5" />
                  新建 SSH 通道
                </Button>
              </div>
            </div>

            {sshProfiles.length === 0 ? (
              <div className="mt-2 rounded-lg border border-dashed border-cyan-200 bg-white/70 p-2.5 text-xs leading-5 text-cyan-900">
                还没有可用 SSH 通道。需要访问内网时，先点击“新建 SSH 通道”。
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                {sshProfiles.map((profile) => {
                  const isSelected = values.sshProfileId === profile.id;
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      className={`w-full rounded-lg border px-2.5 py-2.5 text-left text-xs transition sm:text-sm ${
                        isSelected
                          ? "border-cyan-400 bg-white shadow-sm"
                          : "border-cyan-100 bg-white/70 hover:border-cyan-300"
                      }`}
                      onClick={() => onChange({ ...values, sshProfileId: profile.id })}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-bold text-slate-900">{profile.name}</p>
                          <p className="mt-1 text-[11px] leading-4 text-slate-500 sm:text-xs sm:leading-5">
                            {profile.tunnel.username}@{profile.tunnel.host}:{profile.tunnel.port} ·
                            {profile.tunnel.authMethod === "password" ? " 密码认证" : " 私钥认证"}
                          </p>
                        </div>
                        {isSelected ? (
                          <span className="rounded-full bg-cyan-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-cyan-700">
                            已选中
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedSshProfile ? (
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg px-2 text-xs"
                  aria-label="测试 SSH 通道"
                  disabled={testingSelectedSsh}
                  onClick={() => onTestSsh(selectedSshProfile)}
                >
                  {testingSelectedSsh ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-1 h-3.5 w-3.5" />}
                  {testingSelectedSsh ? "测试中" : "测试"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg px-2 text-xs"
                  onClick={() => onEditSsh(selectedSshProfile)}
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  编辑当前 SSH 通道
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-lg px-2 text-xs"
                  onClick={() => onChange({ ...values, sshProfileId: "" })}
                >
                  清除选择
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-lg px-2 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  onClick={() => onDeleteSsh(selectedSshProfile)}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  删除
                </Button>
              </div>
            ) : null}
          </div>

          <div className="sm:col-span-2 rounded-xl border border-amber-100 bg-amber-50/80 p-2.5">
            <div className="pr-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 sm:text-sm">
                <ShieldAlert className="h-3.5 w-3.5" />
                TLS 校验策略
              </div>
              <p className="mt-1 text-xs leading-5 text-amber-800 sm:text-sm">
                默认校验最安全。跳过校验仅建议用于内网或测试环境；生产连接应使用默认校验、CA 证书或证书指纹。
              </p>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {(["default", "insecure", "caCertificate", "certificateFingerprint"] as const).map((tlsMode) => (
                <Button
                  key={tlsMode}
                  variant={values.tlsMode === tlsMode ? "default" : "outline"}
                  className="h-8 rounded-lg px-2.5 text-xs"
                  onClick={() =>
                    onChange({
                      ...values,
                      tlsMode,
                      insecureTls: tlsMode === "insecure",
                    })
                  }
                >
                  {tlsMode === "default" ? "默认" : tlsMode === "insecure" ? "跳过校验" : tlsMode === "caCertificate" ? "CA 证书" : "证书指纹"}
                </Button>
              ))}
            </div>
            {values.tlsMode === "caCertificate" ? (
              <label className="mt-2 block">
                <span className="mb-1 block text-xs font-semibold text-amber-900 sm:text-sm">CA 证书路径</span>
                <Input
                  placeholder="/path/to/ca.crt"
                  value={values.tlsCaPath}
                  onChange={(event) => onChange({ ...values, tlsCaPath: event.target.value })}
                />
              </label>
            ) : null}
            {values.tlsMode === "certificateFingerprint" ? (
              <label className="mt-2 block">
                <span className="mb-1 block text-xs font-semibold text-amber-900 sm:text-sm">证书 SHA256 指纹</span>
                <Input
                  placeholder="SHA256:..."
                  value={values.tlsFingerprint}
                  onChange={(event) => onChange({ ...values, tlsFingerprint: event.target.value })}
                />
              </label>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-6 flex shrink-0 flex-wrap justify-end gap-3 border-t border-slate-200/80 pt-4 sm:flex-nowrap">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          取消
        </Button>
        <Button onClick={onSave} disabled={saving || incomplete}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          验证并保存连接
        </Button>
      </div>
    </Card>
  );
}
