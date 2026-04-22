import { useMutation } from "@tanstack/react-query";
import {
  CheckCircle2,
  CirclePlus,
  Loader2,
  Pencil,
  PlugZap,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { buildSshTunnelConfig, getSshSecretFromForm } from "../lib/connections";
import {
  buildConnectionLogContextFromForm,
  buildConnectionLogContextFromProfile,
  buildSshLogContextFromForm,
} from "../lib/error-logs";
import {
  DetailedError,
  extractUnknownErrorDiagnostics,
  extractUnknownErrorMessage,
} from "../lib/errors";
import { testConnection } from "../lib/http-client";
import { formatShanghaiDateTime } from "../lib/time";
import { validateSshTunnel } from "../lib/tauri";
import { useAppState } from "../providers/app-state";
import type {
  ConnectionFormValues,
  ConnectionProfile,
  SshProfile,
  SshProfileFormValues,
} from "../types/connections";

const defaultConnectionForm: ConnectionFormValues = {
  name: "",
  baseUrl: "",
  username: "",
  password: "",
  insecureTls: false,
  sshProfileId: "",
};

const defaultSshForm: SshProfileFormValues = {
  name: "",
  sshHost: "",
  sshPort: "22",
  sshUsername: "",
  sshAuthMethod: "password",
  sshPassword: "",
  sshPrivateKeyPath: "",
  sshPassphrase: "",
};

const zhNameSorter = new Intl.Collator("zh-CN");

function compareConnections(left: ConnectionProfile, right: ConnectionProfile) {
  return right.lastUsedAt.localeCompare(left.lastUsedAt) || zhNameSorter.compare(left.name, right.name);
}

export function ConnectionsPage() {
  const navigate = useNavigate();
  const {
    connections,
    sshProfiles,
    currentConnection,
    upsertConnection,
    upsertSshProfile,
    deleteConnection,
    deleteSshProfile,
    setCurrentConnection,
    getPassword,
    getSshSecret,
    getSshProfileForConnection,
    recordErrorLog,
  } = useAppState();
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [sshDialogOpen, setSshDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ConnectionProfile | null>(null);
  const [editingSshProfile, setEditingSshProfile] = useState<SshProfile | null>(null);
  const [connectionFormValues, setConnectionFormValues] = useState<ConnectionFormValues>(defaultConnectionForm);
  const [sshFormValues, setSshFormValues] = useState<SshProfileFormValues>(defaultSshForm);
  const [testingConnectionId, setTestingConnectionId] = useState<string | null>(null);
  const [testingSshProfileId, setTestingSshProfileId] = useState<string | null>(null);

  const sortedConnections = useMemo(
    () => [...connections].sort(compareConnections),
    [connections],
  );

  const sortedSshProfiles = useMemo(
    () => [...sshProfiles].sort((left, right) => right.lastVerifiedAt.localeCompare(left.lastVerifiedAt)),
    [sshProfiles],
  );

  const selectedSshProfile =
    connectionFormValues.sshProfileId.trim()
      ? sshProfiles.find((profile) => profile.id === connectionFormValues.sshProfileId.trim()) ?? null
      : null;

  const sshSaveMutation = useMutation({
    mutationFn: async (payload: SshProfileFormValues) => {
      const sshTunnel = buildSshTunnelConfig(payload);
      const sshSecret = getSshSecretFromForm(payload) || null;
      const result = await validateSshTunnel({
        sshTunnel,
        sshSecret,
      });

      if (!result.ok) {
        throw new DetailedError(result.errorMessage?.trim() || "SSH 通道验证失败", result.diagnostics ?? []);
      }

      return upsertSshProfile(payload, editingSshProfile?.id);
    },
    onSuccess(profile) {
      toast.success(editingSshProfile ? "SSH 通道已更新。" : "SSH 通道已验证并保存。");
      setConnectionFormValues((current) => ({ ...current, sshProfileId: profile.id }));
      setEditingSshProfile(null);
      setSshFormValues(defaultSshForm);
      setSshDialogOpen(false);
    },
    onError(error) {
      const message = extractUnknownErrorMessage(error, "SSH 通道验证失败");
      toast.error(message);
      recordErrorLog({
        scope: "connection-save",
        title: editingSshProfile ? "更新 SSH 通道失败" : "新增 SSH 通道失败",
        summary: message,
        diagnostics: extractUnknownErrorDiagnostics(error),
        connection: buildSshLogContextFromForm(sshFormValues),
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: ConnectionFormValues) => {
      const sshProfile = payload.sshProfileId.trim()
        ? sshProfiles.find((item) => item.id === payload.sshProfileId.trim()) ?? null
        : null;
      const sshSecret = await getSshSecret(sshProfile);

      await testConnection(
        {
          baseUrl: payload.baseUrl,
          username: payload.username,
          insecureTls: payload.insecureTls,
        },
        payload.password,
        sshSecret,
        sshProfile?.tunnel ?? null,
      );

      return upsertConnection(payload, editingConnection?.id);
    },
    onSuccess() {
      toast.success(editingConnection ? "连接已更新。" : "连接已保存。");
      setConnectionDialogOpen(false);
      setEditingConnection(null);
      setConnectionFormValues(defaultConnectionForm);
      navigate("/console");
    },
    onError(error) {
      const message = extractUnknownErrorMessage(error, "连接失败");
      toast.error(message);
      recordErrorLog({
        scope: "connection-save",
        title: editingConnection ? "更新连接失败" : "新增连接失败",
        summary: message,
        diagnostics: extractUnknownErrorDiagnostics(error),
        connection: buildConnectionLogContextFromForm(connectionFormValues, selectedSshProfile),
      });
    },
  });

  function openCreateConnectionDialog() {
    setEditingConnection(null);
    setConnectionFormValues(defaultConnectionForm);
    setConnectionDialogOpen(true);
  }

  async function openEditConnectionDialog(connection: ConnectionProfile) {
    const password = await getPassword(connection);
    setEditingConnection(connection);
    setConnectionFormValues({
      name: connection.name,
      baseUrl: connection.baseUrl,
      username: connection.username,
      password: password ?? "",
      insecureTls: connection.insecureTls,
      sshProfileId: connection.sshProfileId ?? "",
    });
    setConnectionDialogOpen(true);
  }

  function openCreateSshDialog() {
    setEditingSshProfile(null);
    setSshFormValues(defaultSshForm);
    setSshDialogOpen(true);
  }

  async function openEditSshDialog(profile: SshProfile) {
    const sshSecret = await getSshSecret(profile);
    setEditingSshProfile(profile);
    setSshFormValues({
      name: profile.name,
      sshHost: profile.tunnel.host,
      sshPort: String(profile.tunnel.port),
      sshUsername: profile.tunnel.username,
      sshAuthMethod: profile.tunnel.authMethod,
      sshPassword: profile.tunnel.authMethod === "password" ? sshSecret ?? "" : "",
      sshPrivateKeyPath: profile.tunnel.privateKeyPath,
      sshPassphrase: profile.tunnel.authMethod === "privateKey" ? sshSecret ?? "" : "",
    });
    setSshDialogOpen(true);
  }

  async function runSavedSshProfileTest(profile: SshProfile) {
    setTestingSshProfileId(profile.id);
    try {
      const sshSecret = await getSshSecret(profile);
      const result = await validateSshTunnel({
        sshTunnel: profile.tunnel,
        sshSecret,
      });

      if (!result.ok) {
        throw new DetailedError(result.errorMessage?.trim() || "SSH 通道测试失败", result.diagnostics ?? []);
      }

      toast.success("SSH 通道测试成功。");
    } catch (error) {
      const message = extractUnknownErrorMessage(error, "SSH 通道测试失败");
      toast.error(message);
      recordErrorLog({
        scope: "connection-test",
        title: "SSH 通道测试失败",
        summary: message,
        diagnostics: extractUnknownErrorDiagnostics(error),
        connection: {
          name: profile.name,
          sshTunnelEnabled: true,
          sshHost: profile.tunnel.host,
          sshPort: profile.tunnel.port,
          sshUsername: profile.tunnel.username,
          sshAuthMethod: profile.tunnel.authMethod,
        },
      });
    } finally {
      setTestingSshProfileId(null);
    }
  }

  async function runSavedConnectionTest(connection: ConnectionProfile) {
    setTestingConnectionId(connection.id);
    try {
      const sshProfile = getSshProfileForConnection(connection);
      const [password, sshSecret] = await Promise.all([getPassword(connection), getSshSecret(sshProfile)]);
      if (!password) {
        throw new Error("未找到已保存密码，请编辑连接后重新保存。");
      }

      await testConnection(
        {
          baseUrl: connection.baseUrl,
          username: connection.username,
          insecureTls: connection.insecureTls,
        },
        password,
        sshSecret,
        sshProfile?.tunnel ?? null,
      );
      toast.success("连接测试成功。");
    } catch (error) {
      const message = extractUnknownErrorMessage(error, "连接测试失败");
      toast.error(message);
      recordErrorLog({
        scope: "connection-test",
        title: "已保存连接测试失败",
        summary: message,
        diagnostics: extractUnknownErrorDiagnostics(error),
        connection: buildConnectionLogContextFromProfile(connection, getSshProfileForConnection(connection)),
      });
    } finally {
      setTestingConnectionId(null);
    }
  }

  async function handleDeleteSshProfile(profileId: string) {
    await deleteSshProfile(profileId);
    setConnectionFormValues((current) =>
      current.sshProfileId === profileId ? { ...current, sshProfileId: "" } : current,
    );
    toast.success("SSH 通道已删除。");
  }

  async function handleDeleteConnection(connection: ConnectionProfile) {
    if (!window.confirm(`确定删除连接“${connection.name}”吗？该连接下的已保存请求也会一起删除。`)) {
      return;
    }

    await deleteConnection(connection.id);
    toast.success("连接已删除。");
  }

  function handleOpenConnection(connectionId: string) {
    setCurrentConnection(connectionId);
    navigate("/console");
  }

  const sshFormIncomplete =
    !sshFormValues.sshHost.trim() ||
    !sshFormValues.sshPort.trim() ||
    !sshFormValues.sshUsername.trim() ||
    (sshFormValues.sshAuthMethod === "password"
      ? !sshFormValues.sshPassword.trim()
      : !sshFormValues.sshPrivateKeyPath.trim());

  const connectionFormIncomplete =
    !connectionFormValues.baseUrl.trim() ||
    !connectionFormValues.username.trim() ||
    !connectionFormValues.password.trim();

  return (
    <div className="min-h-screen bg-hero-grid px-4 py-8 sm:px-8" onContextMenu={(event) => event.preventDefault()}>
      <div className="mx-auto max-w-7xl space-y-6">
        <Card className="overflow-hidden border-0 bg-slate-950 p-0 shadow-2xl shadow-slate-900/20">
          <div className="grid gap-6 px-6 py-7 text-white sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:px-10">
            <div>
              <p className="text-sm uppercase tracking-[0.36em] text-emerald-300">ESX 桌面版</p>
              <h1 className="mt-4 text-3xl font-extrabold leading-tight sm:text-4xl">连接管理</h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                连接直接保存、测试和切换，SSH 通道继续独立复用。左侧介绍栏已去掉，页面主区域改成更聚焦的工作台布局。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-emerald-200">连接</p>
                <p className="mt-3 text-3xl font-extrabold text-white">{sortedConnections.length}</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">直接进入 Console 的 Elasticsearch 连接。</p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">SSH</p>
                <p className="mt-3 text-3xl font-extrabold text-white">{sortedSshProfiles.length}</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">可复用的跳板机与内网访问通道。</p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-amber-200">当前</p>
                <p className="mt-3 truncate text-lg font-extrabold text-white">{currentConnection?.name ?? "未选择"}</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {currentConnection ? formatShanghaiDateTime(currentConnection.lastUsedAt) : "点击连接后进入 Console。"}
                </p>
              </div>
            </div>
          </div>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-emerald-600">连接管理</p>
                <h2 className="mt-2 text-3xl font-extrabold text-slate-900">连接</h2>
                <p className="mt-2 text-sm leading-7 text-slate-500">
                  连接直接保存为独立项。选中后就能进入 Console，请求分组在连接内部维护。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => navigate("/logs")}>
                  错误日志
                </Button>
                <Button size="sm" onClick={openCreateConnectionDialog}>
                  <CirclePlus className="mr-2 h-4 w-4" />
                  新建连接
                </Button>
              </div>
            </div>

            <div className="mt-4 rounded-[24px] border border-emerald-100 bg-emerald-50/80 p-4">
              <p className="text-sm font-semibold text-emerald-950">当前连接</p>
              <p className="mt-2 text-sm leading-7 text-emerald-900">
                {currentConnection ? `${currentConnection.name} · ${currentConnection.baseUrl}` : "还没有选中的连接。点击下方任意连接即可进入 Console。"}
              </p>
              <p className="mt-2 text-xs leading-6 text-emerald-800">
                共 {sortedConnections.length} 条连接
                {currentConnection ? ` · 最近使用 ${formatShanghaiDateTime(currentConnection.lastUsedAt)}` : ""}
              </p>
            </div>

            <div className="mt-6 space-y-4">
              {sortedConnections.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center">
                  <p className="text-base font-bold text-slate-900">还没有任何连接</p>
                  <p className="mt-2 text-sm leading-7 text-slate-500">点击“新建连接”后，连接会直接出现在这里。</p>
                </div>
              ) : null}

              {sortedConnections.map((connection) => {
                const isCurrent = currentConnection?.id === connection.id;
                const isTesting = testingConnectionId === connection.id;
                const sshProfile = getSshProfileForConnection(connection);

                return (
                  <div
                    key={connection.id}
                    className="rounded-[28px] border border-border bg-white p-5 transition hover:border-emerald-300 hover:bg-emerald-50/40"
                    role="button"
                    tabIndex={0}
                    onClick={() => handleOpenConnection(connection.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleOpenConnection(connection.id);
                      }
                    }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex min-w-0 flex-1 gap-3">
                        {isCurrent ? (
                          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                        ) : (
                          <PlugZap className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-bold text-slate-900">{connection.name}</p>
                            {isCurrent ? (
                              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-700">
                                当前
                              </span>
                            ) : null}
                            {connection.insecureTls ? (
                              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-700">
                                自签名 TLS
                              </span>
                            ) : null}
                            {sshProfile ? (
                              <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700">
                                SSH 通道
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-3 break-all text-sm leading-7 text-slate-500">{connection.baseUrl}</p>
                          <p className="mt-2 text-xs text-slate-400">
                            用户名：{connection.username} · 最近使用：{formatShanghaiDateTime(connection.lastUsedAt)}
                          </p>
                          {sshProfile ? (
                            <p className="mt-1 text-xs text-slate-400">
                              SSH：{sshProfile.tunnel.username}@{sshProfile.tunnel.host}:{sshProfile.tunnel.port}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            void runSavedConnectionTest(connection);
                          }}
                        >
                          {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : "测试"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            void openEditConnectionDialog(connection);
                          }}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteConnection(connection);
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          删除
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-600">SSH 通道</p>
                <h2 className="mt-2 text-3xl font-extrabold text-slate-900">已保存 SSH 通道</h2>
                <p className="mt-2 text-sm leading-7 text-slate-500">
                  先验证 SSH 主机连通性和认证方式。通过后会保存 SSH 配置，后续任意 ES 连接都可以复用。
                </p>
              </div>
              <Button onClick={openCreateSshDialog}>
                <CirclePlus className="mr-2 h-4 w-4" />
                新建 SSH 通道
              </Button>
            </div>

            <div className="mt-6 space-y-4">
              {sortedSshProfiles.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center">
                  <p className="text-base font-bold text-slate-900">还没有任何 SSH 通道</p>
                  <p className="mt-2 text-sm leading-7 text-slate-500">如果 Elasticsearch 只能从内网访问，先新增一条 SSH 通道。</p>
                </div>
              ) : null}

              {sortedSshProfiles.map((profile) => {
                const isTesting = testingSshProfileId === profile.id;
                const usedByCount = connections.filter((connection) => connection.sshProfileId === profile.id).length;

                return (
                  <div key={profile.id} className="rounded-[28px] border border-border bg-white p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex min-w-0 flex-1 gap-3">
                        <PlugZap className="mt-0.5 h-5 w-5 shrink-0 text-cyan-500" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-bold text-slate-900">{profile.name}</p>
                            <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700">
                              SSH
                            </span>
                          </div>
                          <p className="mt-3 break-all text-sm leading-7 text-slate-500">
                            {profile.tunnel.username}@{profile.tunnel.host}:{profile.tunnel.port}
                          </p>
                          <p className="mt-2 text-xs text-slate-400">
                            认证：{profile.tunnel.authMethod === "password" ? "密码" : "私钥"} · 最近验证：
                            {formatShanghaiDateTime(profile.lastVerifiedAt)}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">被 {usedByCount} 个连接使用</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void runSavedSshProfileTest(profile)}
                        >
                          {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : "测试"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void openEditSshDialog(profile)}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          onClick={() => void handleDeleteSshProfile(profile.id)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          删除
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      <Dialog
        open={connectionDialogOpen}
        title={editingConnection ? "编辑连接" : "新增连接"}
        description="连接直接保存为独立项。SSH 通道可选填。"
        onClose={() => {
          if (saveMutation.isPending) {
            return;
          }
          setConnectionDialogOpen(false);
        }}
        footer={
          <>
            <Button variant="outline" onClick={() => setConnectionDialogOpen(false)} disabled={saveMutation.isPending}>
              取消
            </Button>
            <Button onClick={() => saveMutation.mutate(connectionFormValues)} disabled={saveMutation.isPending || connectionFormIncomplete}>
              {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              验证并保存连接
            </Button>
          </>
        }
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2 rounded-[24px] border border-emerald-100 bg-emerald-50/80 p-4">
            <div className="text-sm font-semibold text-emerald-950">保存方式</div>
            <p className="mt-2 text-sm leading-7 text-emerald-900">连接不再区分项目和模块，保存后即可直接在这里切换或进入 Console。</p>
          </div>

          <label className="block sm:col-span-2">
            <span className="mb-2 block text-sm font-semibold text-slate-700">连接名称</span>
            <Input
              placeholder="例如 生产 ES / 预发日志集群"
              value={connectionFormValues.name}
              onChange={(event) =>
                setConnectionFormValues((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Elasticsearch 地址</span>
            <Input
              placeholder={selectedSshProfile ? "http://10.0.0.12:9200" : "https://your-es-host:9200"}
              value={connectionFormValues.baseUrl}
              onChange={(event) =>
                setConnectionFormValues((current) => ({ ...current, baseUrl: event.target.value }))
              }
            />
            <p className="mt-2 text-xs leading-6 text-slate-500">
              {selectedSshProfile
                ? "已选择 SSH 通道时，这里仍然填写 Elasticsearch 的内网 HTTP 地址，例如 `http://10.0.0.12:9200`。"
                : "例如 `https://es.example.com:9200`。如果填写的是 Kibana 页面地址，登录校验会返回 404 或网页内容。"}
            </p>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Elasticsearch 用户名</span>
            <Input
              placeholder="elastic"
              value={connectionFormValues.username}
              onChange={(event) =>
                setConnectionFormValues((current) => ({ ...current, username: event.target.value }))
              }
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Elasticsearch 密码</span>
            <Input
              type="password"
              placeholder="请输入密码"
              value={connectionFormValues.password}
              onChange={(event) =>
                setConnectionFormValues((current) => ({ ...current, password: event.target.value }))
              }
            />
          </label>

          <div className="sm:col-span-2 rounded-[24px] border border-cyan-100 bg-cyan-50/80 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="pr-4">
                <div className="text-sm font-semibold text-cyan-950">访问方式</div>
                <p className="mt-2 text-sm leading-7 text-cyan-900">
                  直连时不经过 SSH。若 Elasticsearch 只能从服务器内网访问，请先选择一条已保存 SSH 通道。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={!connectionFormValues.sshProfileId ? "default" : "outline"}
                  onClick={() => setConnectionFormValues((current) => ({ ...current, sshProfileId: "" }))}
                >
                  直连
                </Button>
                <Button variant="outline" onClick={openCreateSshDialog}>
                  <CirclePlus className="mr-2 h-4 w-4" />
                  新建 SSH 通道
                </Button>
              </div>
            </div>

            {sortedSshProfiles.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-cyan-200 bg-white/70 p-4 text-sm leading-7 text-cyan-900">
                还没有可用 SSH 通道。需要访问内网时，先点击“新建 SSH 通道”。
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {sortedSshProfiles.map((profile) => {
                  const isSelected = connectionFormValues.sshProfileId === profile.id;
                  return (
                    <button
                      key={profile.id}
                      className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                        isSelected
                          ? "border-cyan-400 bg-white shadow-sm"
                          : "border-cyan-100 bg-white/70 hover:border-cyan-300"
                      }`}
                      onClick={() =>
                        setConnectionFormValues((current) => ({
                          ...current,
                          sshProfileId: profile.id,
                        }))
                      }
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-900">{profile.name}</p>
                          <p className="mt-2 text-xs leading-6 text-slate-500">
                            {profile.tunnel.username}@{profile.tunnel.host}:{profile.tunnel.port} ·
                            {profile.tunnel.authMethod === "password" ? " 密码认证" : " 私钥认证"}
                          </p>
                        </div>
                        {isSelected ? (
                          <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700">
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
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void openEditSshDialog(selectedSshProfile)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  编辑当前 SSH 通道
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConnectionFormValues((current) => ({ ...current, sshProfileId: "" }))}
                >
                  清除选择
                </Button>
              </div>
            ) : null}
          </div>

          <div className="sm:col-span-2 flex items-start justify-between rounded-[24px] border border-amber-100 bg-amber-50/80 p-4">
            <div className="pr-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                <ShieldAlert className="h-4 w-4" />
                允许无效证书 / 主机名
              </div>
              <p className="mt-2 text-sm leading-7 text-amber-800">
                仅建议用于内网或测试环境。开启后会放宽 HTTPS 证书校验。
              </p>
            </div>
            <Switch
              checked={connectionFormValues.insecureTls}
              onChange={(event) =>
                setConnectionFormValues((current) => ({ ...current, insecureTls: event.target.checked }))
              }
            />
          </div>
        </div>
      </Dialog>

      <Dialog
        open={sshDialogOpen}
        title={editingSshProfile ? "编辑 SSH 通道" : "新增 SSH 通道"}
        description="这里只验证 SSH 主机本身是否可连通以及认证方式是否正确。保存成功后，ES 连接就可以复用这条已保存 SSH 通道。"
        onClose={() => {
          if (sshSaveMutation.isPending) {
            return;
          }
          setSshDialogOpen(false);
        }}
        footer={
          <>
            <Button variant="outline" onClick={() => setSshDialogOpen(false)} disabled={sshSaveMutation.isPending}>
              取消
            </Button>
            <Button
              onClick={() => sshSaveMutation.mutate(sshFormValues)}
              disabled={sshSaveMutation.isPending || sshFormIncomplete}
            >
              {sshSaveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              验证并保存 SSH 通道
            </Button>
          </>
        }
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-2 block text-sm font-semibold text-slate-700">SSH 通道名称</span>
            <Input
              placeholder="例如 生产跳板机 / 测试堡垒机"
              value={sshFormValues.name}
              onChange={(event) => setSshFormValues((current) => ({ ...current, name: event.target.value }))}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">SSH 主机</span>
            <Input
              placeholder="bastion.example.com"
              value={sshFormValues.sshHost}
              onChange={(event) => setSshFormValues((current) => ({ ...current, sshHost: event.target.value }))}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">SSH 端口</span>
            <Input
              type="number"
              min="1"
              max="65535"
              placeholder="22"
              value={sshFormValues.sshPort}
              onChange={(event) => setSshFormValues((current) => ({ ...current, sshPort: event.target.value }))}
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-2 block text-sm font-semibold text-slate-700">SSH 用户名</span>
            <Input
              placeholder="ubuntu / root / deploy"
              value={sshFormValues.sshUsername}
              onChange={(event) => setSshFormValues((current) => ({ ...current, sshUsername: event.target.value }))}
            />
          </label>

          <div className="sm:col-span-2">
            <span className="mb-2 block text-sm font-semibold text-slate-700">SSH 认证方式</span>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={sshFormValues.sshAuthMethod === "password" ? "default" : "outline"}
                onClick={() => setSshFormValues((current) => ({ ...current, sshAuthMethod: "password" }))}
              >
                密码
              </Button>
              <Button
                variant={sshFormValues.sshAuthMethod === "privateKey" ? "default" : "outline"}
                onClick={() => setSshFormValues((current) => ({ ...current, sshAuthMethod: "privateKey" }))}
              >
                私钥
              </Button>
            </div>
          </div>

          {sshFormValues.sshAuthMethod === "password" ? (
            <label className="block sm:col-span-2">
              <span className="mb-2 block text-sm font-semibold text-slate-700">SSH 密码</span>
              <Input
                type="password"
                placeholder="请输入 SSH 密码"
                value={sshFormValues.sshPassword}
                onChange={(event) => setSshFormValues((current) => ({ ...current, sshPassword: event.target.value }))}
              />
            </label>
          ) : (
            <>
              <label className="block sm:col-span-2">
                <span className="mb-2 block text-sm font-semibold text-slate-700">SSH 私钥路径</span>
                <Input
                  placeholder="/Users/ushopal/.ssh/id_rsa"
                  value={sshFormValues.sshPrivateKeyPath}
                  onChange={(event) =>
                    setSshFormValues((current) => ({ ...current, sshPrivateKeyPath: event.target.value }))
                  }
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-2 block text-sm font-semibold text-slate-700">私钥口令（可选）</span>
                <Input
                  type="password"
                  placeholder="如果私钥有口令，请在这里填写"
                  value={sshFormValues.sshPassphrase}
                  onChange={(event) =>
                    setSshFormValues((current) => ({ ...current, sshPassphrase: event.target.value }))
                  }
                />
              </label>
            </>
          )}
        </div>
      </Dialog>
    </div>
  );
}
