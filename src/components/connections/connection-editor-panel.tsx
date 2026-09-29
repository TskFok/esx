import { CirclePlus, Database, Loader2, Pencil, ShieldAlert, Trash2, Zap } from "lucide-react";
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
      <Card className="flex h-full min-h-0 flex-col items-center justify-center rounded-md border-border bg-white p-8 text-center shadow-sm">
        <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-md border border-primary/20 bg-secondary text-primary">
          <Database className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="section-title text-slate-900">选择连接以开始工作</h2>
        <p className="section-subtitle mt-2 max-w-sm text-slate-600">选择左侧连接进入 Console，或新建一条连接。</p>
        <Button className="mt-5 h-10 rounded-md px-4 text-xs shadow-none" onClick={onCreate}>
          <CirclePlus className="mr-1 h-4 w-4" />
          新建连接
        </Button>
      </Card>
    );
  }

  const testingSelectedSsh = Boolean(selectedSshProfile && testingSshProfileId === selectedSshProfile.id);

  return (
    <Card className="mx-auto flex h-full min-h-0 w-full max-w-[900px] flex-col overflow-hidden rounded-md border-border bg-white shadow-sm">
      <div className="panel-heading shrink-0 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <h2 className="section-title text-slate-900">{mode === "edit" ? "编辑连接" : "新增连接"}</h2>
          <p className="section-subtitle mt-1 text-slate-600">配置 Elasticsearch 地址、认证和可选 SSH 通道。</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
          <h3 className="sm:col-span-2 text-sm font-semibold text-slate-900">基本信息</h3>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-xs font-medium text-slate-900">连接名称</span>
            <Input
              placeholder="例如 生产 ES / 预发日志集群"
              value={values.name}
              onChange={(event) => onChange({ ...values, name: event.target.value })}
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-xs font-medium text-slate-900">Elasticsearch 地址</span>
            <Input
              placeholder={selectedSshProfile ? "http://10.0.0.12:9200" : "https://your-es-host:9200"}
              value={values.baseUrl}
              onChange={(event) => onChange({ ...values, baseUrl: event.target.value })}
            />
            <p className="mt-1.5 text-[11px] leading-5 text-slate-600">
              {selectedSshProfile
                ? "已选择 SSH 通道时，这里仍然填写 Elasticsearch 的内网 HTTP 地址，例如 `http://10.0.0.12:9200`。"
                : "例如 `https://es.example.com:9200`。如果填写的是 Kibana 页面地址，登录校验会返回 404 或网页内容。"}
            </p>
          </label>

          <div className="sm:col-span-2 border-t border-border pt-5">
            <p className="text-sm font-semibold text-slate-900">认证方式</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["basic", "apiKey", "bearer"] as const).map((authType) => (
                <Button
                  key={authType}
                  variant={values.authType === authType ? "default" : "outline"}
                  className="h-8 rounded-md px-3 text-xs shadow-none"
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
                <span className="mb-1.5 block text-xs font-medium text-slate-900">Elasticsearch 用户名</span>
                <Input
                  placeholder="elastic"
                  value={values.username}
                  onChange={(event) => onChange({ ...values, username: event.target.value })}
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-900">Elasticsearch 密码</span>
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
              <span className="mb-1.5 block text-xs font-medium text-slate-900">API Key</span>
              <Input
                type="password"
                placeholder="请输入 Elasticsearch API Key"
                value={values.apiKey}
                onChange={(event) => onChange({ ...values, apiKey: event.target.value })}
              />
            </label>
          ) : (
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-slate-900">Bearer Token</span>
              <Input
                type="password"
                placeholder="请输入 Bearer Token"
                value={values.bearerToken}
                onChange={(event) => onChange({ ...values, bearerToken: event.target.value })}
              />
            </label>
          )}

          <div className="sm:col-span-2 border-t border-border pt-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">环境与写入保护</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">生产环境会对危险操作启用更严格确认；只读连接会阻断写入请求。</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600">只读</span>
                <Switch
                  checked={values.readonly}
                  onChange={(event) => onChange({ ...values, readonly: event.target.checked })}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["dev", "test", "staging", "prod"] as const).map((environment) => (
                <Button
                  key={environment}
                  variant={values.environment === environment ? "default" : "outline"}
                  className="h-8 rounded-md px-3 text-xs shadow-none"
                  onClick={() => onChange({ ...values, environment })}
                >
                  {environment === "prod" ? "生产" : environment === "staging" ? "预发" : environment === "test" ? "测试" : "开发"}
                </Button>
              ))}
            </div>
          </div>

          <div className="sm:col-span-2 border-t border-border pt-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="pr-2">
                <div className="text-sm font-semibold text-slate-900">访问方式</div>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  直连时不经过 SSH。若 Elasticsearch 只能从服务器内网访问，请先选择一条已保存 SSH 通道。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={!values.sshProfileId ? "default" : "outline"}
                  className="h-8 rounded-md px-3 text-xs shadow-none"
                  onClick={() => onChange({ ...values, sshProfileId: "" })}
                >
                  直连
                </Button>
                <Button variant="outline" className="h-8 rounded-md px-3 text-xs shadow-none" onClick={onCreateSsh}>
                  <CirclePlus className="mr-1 h-3.5 w-3.5" />
                  新建 SSH 通道
                </Button>
              </div>
            </div>

            {sshProfiles.length === 0 ? (
              <div className="mt-3 rounded-md border border-dashed border-primary/20 p-3 text-xs leading-5 text-slate-600">
                还没有可用 SSH 通道。需要访问内网时，先点击“新建 SSH 通道”。
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {sshProfiles.map((profile) => {
                  const isSelected = values.sshProfileId === profile.id;
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      className={`w-full rounded-md border px-3 py-2.5 text-left text-xs transition-colors sm:text-sm ${
                        isSelected
                          ? "border-primary bg-secondary"
                          : "border-border bg-white hover:border-primary/40"
                      }`}
                      onClick={() => onChange({ ...values, sshProfileId: profile.id })}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium text-slate-900">{profile.name}</p>
                          <p className="mt-1 text-[11px] leading-4 text-slate-600 sm:text-xs sm:leading-5">
                            {profile.tunnel.username}@{profile.tunnel.host}:{profile.tunnel.port} ·
                            {profile.tunnel.authMethod === "password" ? " 密码认证" : " 私钥认证"}
                          </p>
                        </div>
                        {isSelected ? (
                          <span className="rounded bg-primary/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-primary">
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
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-md px-2 text-xs shadow-none"
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
                  className="h-8 rounded-md px-2 text-xs shadow-none"
                  onClick={() => onEditSsh(selectedSshProfile)}
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  编辑当前 SSH 通道
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-md px-2 text-xs shadow-none"
                  onClick={() => onChange({ ...values, sshProfileId: "" })}
                >
                  清除选择
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-md px-2 text-xs text-[#ad0017] hover:bg-[#fff0f1] hover:text-[#ad0017]"
                  onClick={() => onDeleteSsh(selectedSshProfile)}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  删除
                </Button>
              </div>
            ) : null}
          </div>

          <div className="sm:col-span-2 border-t border-border pt-5">
            <div className="pr-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <ShieldAlert className="h-3.5 w-3.5" />
                TLS 校验策略
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                默认校验最安全。跳过校验仅建议用于内网或测试环境；生产连接应使用默认校验、CA 证书或证书指纹。
              </p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["default", "insecure", "caCertificate", "certificateFingerprint"] as const).map((tlsMode) => (
                <Button
                  key={tlsMode}
                  variant={values.tlsMode === tlsMode ? "default" : "outline"}
                  className="h-8 rounded-md px-3 text-xs shadow-none"
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
                <span className="mb-1.5 block text-xs font-medium text-slate-900">CA 证书路径</span>
                <Input
                  placeholder="/path/to/ca.crt"
                  value={values.tlsCaPath}
                  onChange={(event) => onChange({ ...values, tlsCaPath: event.target.value })}
                />
              </label>
            ) : null}
            {values.tlsMode === "certificateFingerprint" ? (
              <label className="mt-2 block">
                <span className="mb-1.5 block text-xs font-medium text-slate-900">证书 SHA256 指纹</span>
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

      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border bg-white px-5 py-4 sm:flex-nowrap sm:px-6">
        <Button variant="outline" className="h-10 rounded-md px-4 text-xs shadow-none" onClick={onCancel} disabled={saving}>
          取消
        </Button>
        <Button className="h-10 rounded-md px-4 text-xs shadow-none" onClick={onSave} disabled={saving || incomplete}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          验证并保存连接
        </Button>
      </div>
    </Card>
  );
}
