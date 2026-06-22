import { useMutation } from "@tanstack/react-query";
import {
  CheckCircle2,
  CirclePlus,
  Download,
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
import { ConnectionExportDialog } from "../components/connections/connection-export-dialog";
import { Dialog } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import {
  getAuthSecretFromForm,
  validateConnectionSecurity,
  validateSshHostKey,
} from "../lib/connection-security";
import { buildSshTunnelConfig, getSshSecretFromForm } from "../lib/connections";
import {
  buildConnectionDeleteDescription,
  buildSshProfileDeleteDescription,
} from "../lib/delete-confirmations";
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
import {
  buildConnectionExportFilename,
  encryptConnectionExportPayload,
  serializeEncryptedConnectionExportFile,
} from "../lib/connection-import-export";
import { testConnection } from "../lib/http-client";
import { downloadExportContent } from "../lib/request-import-export";
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
  authType: "basic",
  username: "",
  password: "",
  apiKey: "",
  bearerToken: "",
  tlsMode: "default",
  tlsCaPath: "",
  tlsFingerprint: "",
  insecureTls: false,
  environment: "dev",
  readonly: false,
  allowInsecureProductionTls: false,
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
    exportConnections,
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
  const [pendingDeleteConnection, setPendingDeleteConnection] = useState<ConnectionProfile | null>(null);
  const [deletingConnection, setDeletingConnection] = useState(false);
  const [pendingDeleteSshProfile, setPendingDeleteSshProfile] = useState<SshProfile | null>(null);
  const [deletingSshProfile, setDeletingSshProfile] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

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

      const timestamp = new Date().toISOString();
      const profileForValidation: SshProfile =
        editingSshProfile ?? {
          id: "temporary",
          name: payload.name.trim() || sshTunnel.host,
          tunnel: sshTunnel,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastVerifiedAt: timestamp,
          hostKeyPolicy: "trustOnFirstUse",
          trustedHostKeySha256: null,
        };
      const hostKeyValidation = validateSshHostKey(profileForValidation, result.hostKeySha256 ?? null);
      if (!hostKeyValidation.ok) {
        throw new DetailedError(hostKeyValidation.errorMessage ?? "SSH 主机指纹校验失败", result.diagnostics ?? []);
      }

      return upsertSshProfile(payload, editingSshProfile?.id, hostKeyValidation.trustedHostKeySha256);
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
      const securityValidation = validateConnectionSecurity({
        id: editingConnection?.id ?? "temporary",
        name: payload.name.trim() || payload.baseUrl.trim(),
        baseUrl: payload.baseUrl,
        username: payload.username,
        auth: { type: payload.authType },
        tls: {
          mode: payload.tlsMode,
          caPath: payload.tlsCaPath.trim() || undefined,
          fingerprint: payload.tlsFingerprint.trim() || undefined,
        },
        environment: payload.environment,
        readonly: payload.readonly,
        insecureTls: payload.tlsMode === "insecure" || payload.insecureTls,
        sshProfileId: payload.sshProfileId.trim() || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
      }, { allowInsecureProductionTls: payload.allowInsecureProductionTls });
      if (!securityValidation.ok) {
        throw new DetailedError(securityValidation.warnings[0] ?? "连接安全配置无效", securityValidation.warnings);
      }

      await testConnection(
        {
          baseUrl: payload.baseUrl,
          username: payload.username,
          auth: { type: payload.authType },
          tls: {
            mode: payload.tlsMode,
            caPath: payload.tlsCaPath.trim() || undefined,
            fingerprint: payload.tlsFingerprint.trim() || undefined,
          },
          environment: payload.environment,
          readonly: payload.readonly,
          insecureTls: payload.tlsMode === "insecure" || payload.insecureTls,
        },
        getAuthSecretFromForm(payload),
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
    const authType = connection.auth?.type ?? "basic";
    setEditingConnection(connection);
    setConnectionFormValues({
      name: connection.name,
      baseUrl: connection.baseUrl,
      authType,
      username: connection.username,
      password: authType === "basic" ? password ?? "" : "",
      apiKey: authType === "apiKey" ? password ?? "" : "",
      bearerToken: authType === "bearer" ? password ?? "" : "",
      tlsMode: connection.tls?.mode ?? (connection.insecureTls ? "insecure" : "default"),
      tlsCaPath: connection.tls?.caPath ?? "",
      tlsFingerprint: connection.tls?.fingerprint ?? "",
      insecureTls: connection.insecureTls || connection.tls?.mode === "insecure",
      environment: connection.environment ?? "dev",
      readonly: connection.readonly ?? false,
      allowInsecureProductionTls: false,
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

      const hostKeyValidation = validateSshHostKey(profile, result.hostKeySha256 ?? null);
      if (!hostKeyValidation.ok) {
        throw new DetailedError(hostKeyValidation.errorMessage ?? "SSH 主机指纹校验失败", result.diagnostics ?? []);
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
          auth: connection.auth,
          tls: connection.tls,
          environment: connection.environment,
          readonly: connection.readonly,
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

  function handleDeleteSshProfile(profile: SshProfile) {
    setPendingDeleteSshProfile(profile);
  }

  async function submitDeleteSshProfileDialog() {
    if (!pendingDeleteSshProfile) {
      return;
    }

    setDeletingSshProfile(true);
    try {
      await deleteSshProfile(pendingDeleteSshProfile.id);
      setConnectionFormValues((current) =>
        current.sshProfileId === pendingDeleteSshProfile.id ? { ...current, sshProfileId: "" } : current,
      );
      toast.success("SSH 通道已删除。");
      setPendingDeleteSshProfile(null);
    } catch (error) {
      toast.error(extractUnknownErrorMessage(error, "删除 SSH 通道失败"));
    } finally {
      setDeletingSshProfile(false);
    }
  }

  function handleDeleteConnection(connection: ConnectionProfile) {
    setPendingDeleteConnection(connection);
  }

  async function submitDeleteConnectionDialog() {
    if (!pendingDeleteConnection) {
      return;
    }

    setDeletingConnection(true);
    try {
      await deleteConnection(pendingDeleteConnection.id);
      toast.success("连接已删除。");
      setPendingDeleteConnection(null);
    } catch (error) {
      toast.error(extractUnknownErrorMessage(error, "删除连接失败"));
    } finally {
      setDeletingConnection(false);
    }
  }

  function handleOpenConnection(connectionId: string) {
    setCurrentConnection(connectionId);
    navigate("/console");
  }

  async function handleConfirmExport(payload: { password: string }) {
    setExporting(true);
    try {
      const exportPayload = await exportConnections();
      const encrypted = await encryptConnectionExportPayload(exportPayload, payload.password);
      downloadExportContent(
        serializeEncryptedConnectionExportFile(encrypted),
        buildConnectionExportFilename(),
      );
      setExportDialogOpen(false);
      toast.success(`已导出 ${exportPayload.connections.length} 条连接。`);
    } catch (error) {
      toast.error(extractUnknownErrorMessage(error, "导出连接失败"));
    } finally {
      setExporting(false);
    }
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
    (connectionFormValues.authType === "basic"
      ? !connectionFormValues.username.trim() || !connectionFormValues.password.trim()
      : connectionFormValues.authType === "apiKey"
        ? !connectionFormValues.apiKey.trim()
        : !connectionFormValues.bearerToken.trim()) ||
    (connectionFormValues.tlsMode === "caCertificate" && !connectionFormValues.tlsCaPath.trim()) ||
    (connectionFormValues.tlsMode === "certificateFingerprint" && !connectionFormValues.tlsFingerprint.trim());

  return (
    <div className="min-h-screen bg-hero-grid px-4 py-4 sm:px-6 sm:py-5" onContextMenu={(event) => event.preventDefault()}>
      <div className="mx-auto max-w-7xl space-y-3">
        <Card className="overflow-hidden border-0 bg-slate-950 p-0 shadow-xl shadow-slate-900/20">
          <div className="grid gap-4 px-4 py-4 text-white sm:px-5 lg:grid-cols-[1.1fr_0.9fr] lg:px-6">
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-emerald-300">ESX 桌面版</p>
              <h1 className="mt-2 text-xl font-bold leading-tight sm:text-2xl">连接管理</h1>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-300 sm:text-sm">
                连接直接保存、测试和切换，SSH 通道继续独立复用。左侧介绍栏已去掉，页面主区域改成更聚焦的工作台布局。
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-200">连接</p>
                <p className="mt-1 text-2xl font-bold text-white">{sortedConnections.length}</p>
                <p className="mt-1 text-xs leading-5 text-slate-300">直接进入 Console 的 Elasticsearch 连接。</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-200">SSH</p>
                <p className="mt-1 text-2xl font-bold text-white">{sortedSshProfiles.length}</p>
                <p className="mt-1 text-xs leading-5 text-slate-300">可复用的跳板机与内网访问通道。</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-amber-200">当前</p>
                <p className="mt-1 truncate text-base font-bold text-white">{currentConnection?.name ?? "未选择"}</p>
                <p className="mt-1 text-xs leading-5 text-slate-300">
                  {currentConnection ? formatShanghaiDateTime(currentConnection.lastUsedAt) : "点击连接后进入 Console。"}
                </p>
              </div>
            </div>
          </div>
        </Card>

        <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-emerald-600">连接管理</p>
                <h2 className="mt-1 text-lg font-bold text-slate-900">连接</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">
                  连接直接保存为独立项。选中后就能进入 Console，请求分组在连接内部维护。
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button variant="outline" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => navigate("/logs")}>
                  错误日志
                </Button>
                <Button
                  variant="outline"
                  className="h-8 rounded-lg px-2.5 text-xs"
                  onClick={() => setExportDialogOpen(true)}
                  disabled={sortedConnections.length === 0}
                >
                  <Download className="mr-1 h-3.5 w-3.5" />
                  导出
                </Button>
                <Button className="h-8 rounded-lg px-2.5 text-xs" onClick={openCreateConnectionDialog}>
                  <CirclePlus className="mr-1 h-3.5 w-3.5" />
                  新建连接
                </Button>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/80 p-2.5">
              <p className="text-xs font-semibold text-emerald-950">当前连接</p>
              <p className="mt-1 text-xs leading-5 text-emerald-900 sm:text-sm">
                {currentConnection ? `${currentConnection.name} · ${currentConnection.baseUrl}` : "还没有选中的连接。点击下方任意连接即可进入 Console。"}
              </p>
              <p className="mt-1 text-[11px] leading-4 text-emerald-800">
                共 {sortedConnections.length} 条连接
                {currentConnection ? ` · 最近使用 ${formatShanghaiDateTime(currentConnection.lastUsedAt)}` : ""}
              </p>
            </div>

            <div className="mt-3 space-y-2">
              {sortedConnections.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-4 text-center">
                  <p className="text-sm font-bold text-slate-900">还没有任何连接</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">点击“新建连接”后，连接会直接出现在这里。</p>
                </div>
              ) : null}

              {sortedConnections.map((connection) => {
                const isCurrent = currentConnection?.id === connection.id;
                const isTesting = testingConnectionId === connection.id;
                const sshProfile = getSshProfileForConnection(connection);

                return (
                  <div
                    key={connection.id}
                    className="rounded-xl border border-border bg-white p-3 transition hover:border-emerald-300 hover:bg-emerald-50/40"
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
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 gap-2">
                        {isCurrent ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        ) : (
                          <PlugZap className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-sm font-bold text-slate-900">{connection.name}</p>
                            {isCurrent ? (
                              <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-emerald-700">
                                当前
                              </span>
                            ) : null}
                            {connection.insecureTls ? (
                              <span className="rounded-full bg-amber-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-amber-700">
                                自签名 TLS
                              </span>
                            ) : null}
                            {sshProfile ? (
                              <span className="rounded-full bg-cyan-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-cyan-700">
                                SSH 通道
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1.5 break-all text-xs leading-5 text-slate-500 sm:text-sm">{connection.baseUrl}</p>
                          <p className="mt-1 text-[11px] text-slate-400">
                            用户名：{connection.username} · 最近使用：{formatShanghaiDateTime(connection.lastUsedAt)}
                          </p>
                          {sshProfile ? (
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              SSH：{sshProfile.tunnel.username}@{sshProfile.tunnel.host}:{sshProfile.tunnel.port}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg px-2 text-xs"
                          onClick={(event) => {
                            event.stopPropagation();
                            void runSavedConnectionTest(connection);
                          }}
                        >
                          {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "测试"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 rounded-lg px-2 text-xs"
                          onClick={(event) => {
                            event.stopPropagation();
                            void openEditConnectionDialog(connection);
                          }}
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 rounded-lg px-2 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteConnection(connection);
                          }}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          删除
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-600">SSH 通道</p>
                <h2 className="mt-1 text-lg font-bold text-slate-900">已保存 SSH 通道</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">
                  先验证 SSH 主机连通性和认证方式。通过后会保存 SSH 配置，后续任意 ES 连接都可以复用。
                </p>
              </div>
              <Button className="h-8 rounded-lg px-2.5 text-xs" onClick={openCreateSshDialog}>
                <CirclePlus className="mr-1 h-3.5 w-3.5" />
                新建 SSH 通道
              </Button>
            </div>

            <div className="mt-3 space-y-2">
              {sortedSshProfiles.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-4 text-center">
                  <p className="text-sm font-bold text-slate-900">还没有任何 SSH 通道</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">如果 Elasticsearch 只能从内网访问，先新增一条 SSH 通道。</p>
                </div>
              ) : null}

              {sortedSshProfiles.map((profile) => {
                const isTesting = testingSshProfileId === profile.id;
                const usedByCount = connections.filter((connection) => connection.sshProfileId === profile.id).length;

                return (
                  <div key={profile.id} className="rounded-xl border border-border bg-white p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 gap-2">
                        <PlugZap className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-sm font-bold text-slate-900">{profile.name}</p>
                            <span className="rounded-full bg-cyan-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-cyan-700">
                              SSH
                            </span>
                          </div>
                          <p className="mt-1.5 break-all text-xs leading-5 text-slate-500 sm:text-sm">
                            {profile.tunnel.username}@{profile.tunnel.host}:{profile.tunnel.port}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-400">
                            认证：{profile.tunnel.authMethod === "password" ? "密码" : "私钥"} · 最近验证：
                            {formatShanghaiDateTime(profile.lastVerifiedAt)}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-400">被 {usedByCount} 个连接使用</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg px-2 text-xs"
                          onClick={() => void runSavedSshProfileTest(profile)}
                        >
                          {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "测试"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 rounded-lg px-2 text-xs"
                          onClick={() => void openEditSshDialog(profile)}
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 rounded-lg px-2 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          onClick={() => handleDeleteSshProfile(profile)}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
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
              value={connectionFormValues.name}
              onChange={(event) =>
                setConnectionFormValues((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">Elasticsearch 地址</span>
            <Input
              placeholder={selectedSshProfile ? "http://10.0.0.12:9200" : "https://your-es-host:9200"}
              value={connectionFormValues.baseUrl}
              onChange={(event) =>
                setConnectionFormValues((current) => ({ ...current, baseUrl: event.target.value }))
              }
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
                  variant={connectionFormValues.authType === authType ? "default" : "outline"}
                  className="h-8 rounded-lg px-2.5 text-xs"
                  onClick={() => setConnectionFormValues((current) => ({ ...current, authType }))}
                >
                  {authType === "basic" ? "Basic" : authType === "apiKey" ? "API Key" : "Bearer"}
                </Button>
              ))}
            </div>
          </div>

          {connectionFormValues.authType === "basic" ? (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">Elasticsearch 用户名</span>
                <Input
                  placeholder="elastic"
                  value={connectionFormValues.username}
                  onChange={(event) =>
                    setConnectionFormValues((current) => ({ ...current, username: event.target.value }))
                  }
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">Elasticsearch 密码</span>
                <Input
                  type="password"
                  placeholder="请输入密码"
                  value={connectionFormValues.password}
                  onChange={(event) =>
                    setConnectionFormValues((current) => ({ ...current, password: event.target.value }))
                  }
                />
              </label>
            </>
          ) : connectionFormValues.authType === "apiKey" ? (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">API Key</span>
              <Input
                type="password"
                placeholder="请输入 Elasticsearch API Key"
                value={connectionFormValues.apiKey}
                onChange={(event) => setConnectionFormValues((current) => ({ ...current, apiKey: event.target.value }))}
              />
            </label>
          ) : (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">Bearer Token</span>
              <Input
                type="password"
                placeholder="请输入 Bearer Token"
                value={connectionFormValues.bearerToken}
                onChange={(event) =>
                  setConnectionFormValues((current) => ({ ...current, bearerToken: event.target.value }))
                }
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
                  checked={connectionFormValues.readonly}
                  onChange={(event) => setConnectionFormValues((current) => ({ ...current, readonly: event.target.checked }))}
                />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {(["dev", "test", "staging", "prod"] as const).map((environment) => (
                <Button
                  key={environment}
                  variant={connectionFormValues.environment === environment ? "default" : "outline"}
                  className="h-8 rounded-lg px-2.5 text-xs"
                  onClick={() => setConnectionFormValues((current) => ({ ...current, environment }))}
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
                  variant={!connectionFormValues.sshProfileId ? "default" : "outline"}
                  className="h-8 rounded-lg px-2.5 text-xs"
                  onClick={() => setConnectionFormValues((current) => ({ ...current, sshProfileId: "" }))}
                >
                  直连
                </Button>
                <Button variant="outline" className="h-8 rounded-lg px-2.5 text-xs" onClick={openCreateSshDialog}>
                  <CirclePlus className="mr-1 h-3.5 w-3.5" />
                  新建 SSH 通道
                </Button>
              </div>
            </div>

            {sortedSshProfiles.length === 0 ? (
              <div className="mt-2 rounded-lg border border-dashed border-cyan-200 bg-white/70 p-2.5 text-xs leading-5 text-cyan-900">
                还没有可用 SSH 通道。需要访问内网时，先点击“新建 SSH 通道”。
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                {sortedSshProfiles.map((profile) => {
                  const isSelected = connectionFormValues.sshProfileId === profile.id;
                  return (
                    <button
                      key={profile.id}
                      className={`w-full rounded-lg border px-2.5 py-2.5 text-left text-xs transition sm:text-sm ${
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
                <Button variant="outline" size="sm" className="h-8 rounded-lg px-2 text-xs" onClick={() => void openEditSshDialog(selectedSshProfile)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  编辑当前 SSH 通道
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-lg px-2 text-xs"
                  onClick={() => setConnectionFormValues((current) => ({ ...current, sshProfileId: "" }))}
                >
                  清除选择
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
                  variant={connectionFormValues.tlsMode === tlsMode ? "default" : "outline"}
                  className="h-8 rounded-lg px-2.5 text-xs"
                  onClick={() =>
                    setConnectionFormValues((current) => ({
                      ...current,
                      tlsMode,
                      insecureTls: tlsMode === "insecure",
                    }))
                  }
                >
                  {tlsMode === "default" ? "默认" : tlsMode === "insecure" ? "跳过校验" : tlsMode === "caCertificate" ? "CA 证书" : "证书指纹"}
                </Button>
              ))}
            </div>
            {connectionFormValues.tlsMode === "caCertificate" ? (
              <label className="mt-2 block">
                <span className="mb-1 block text-xs font-semibold text-amber-900 sm:text-sm">CA 证书路径</span>
                <Input
                  placeholder="/path/to/ca.crt"
                  value={connectionFormValues.tlsCaPath}
                  onChange={(event) => setConnectionFormValues((current) => ({ ...current, tlsCaPath: event.target.value }))}
                />
              </label>
            ) : null}
            {connectionFormValues.tlsMode === "certificateFingerprint" ? (
              <label className="mt-2 block">
                <span className="mb-1 block text-xs font-semibold text-amber-900 sm:text-sm">证书 SHA256 指纹</span>
                <Input
                  placeholder="SHA256:..."
                  value={connectionFormValues.tlsFingerprint}
                  onChange={(event) => setConnectionFormValues((current) => ({ ...current, tlsFingerprint: event.target.value }))}
                />
              </label>
            ) : null}
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
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">SSH 通道名称</span>
            <Input
              placeholder="例如 生产跳板机 / 测试堡垒机"
              value={sshFormValues.name}
              onChange={(event) => setSshFormValues((current) => ({ ...current, name: event.target.value }))}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">SSH 主机</span>
            <Input
              placeholder="bastion.example.com"
              value={sshFormValues.sshHost}
              onChange={(event) => setSshFormValues((current) => ({ ...current, sshHost: event.target.value }))}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">SSH 端口</span>
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
            <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">SSH 用户名</span>
            <Input
              placeholder="ubuntu / root / deploy"
              value={sshFormValues.sshUsername}
              onChange={(event) => setSshFormValues((current) => ({ ...current, sshUsername: event.target.value }))}
            />
          </label>

          <div className="sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">SSH 认证方式</span>
            <div className="flex flex-wrap gap-1">
              <Button
                variant={sshFormValues.sshAuthMethod === "password" ? "default" : "outline"}
                className="h-8 rounded-lg px-2.5 text-xs"
                onClick={() => setSshFormValues((current) => ({ ...current, sshAuthMethod: "password" }))}
              >
                密码
              </Button>
              <Button
                variant={sshFormValues.sshAuthMethod === "privateKey" ? "default" : "outline"}
                className="h-8 rounded-lg px-2.5 text-xs"
                onClick={() => setSshFormValues((current) => ({ ...current, sshAuthMethod: "privateKey" }))}
              >
                私钥
              </Button>
            </div>
          </div>

          {sshFormValues.sshAuthMethod === "password" ? (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">SSH 密码</span>
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
              <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">SSH 私钥路径</span>
                <Input
                  placeholder="~/.ssh/id_rsa"
                  value={sshFormValues.sshPrivateKeyPath}
                  onChange={(event) =>
                    setSshFormValues((current) => ({ ...current, sshPrivateKeyPath: event.target.value }))
                  }
                />
              </label>

            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-slate-700 sm:text-sm">私钥口令（可选）</span>
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

      <ConnectionExportDialog
        open={exportDialogOpen}
        connectionCount={sortedConnections.length}
        sshProfileCount={
          new Set(sortedConnections.map((connection) => connection.sshProfileId).filter(Boolean)).size
        }
        exporting={exporting}
        onClose={() => {
          if (!exporting) {
            setExportDialogOpen(false);
          }
        }}
        onConfirm={handleConfirmExport}
      />

      <Dialog
        open={pendingDeleteConnection != null}
        title="确认删除"
        description={
          pendingDeleteConnection ? buildConnectionDeleteDescription(pendingDeleteConnection) : ""
        }
        onClose={() => {
          if (!deletingConnection) {
            setPendingDeleteConnection(null);
          }
        }}
        onConfirm={submitDeleteConnectionDialog}
        confirmDisabled={deletingConnection}
        footer={
          <>
            <Button variant="outline" disabled={deletingConnection} onClick={() => setPendingDeleteConnection(null)}>
              取消
            </Button>
            <Button variant="destructive" disabled={deletingConnection} onClick={() => void submitDeleteConnectionDialog()}>
              {deletingConnection ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              删除
            </Button>
          </>
        }
      >
        <div className="text-sm leading-7 text-slate-600">删除后不可恢复。</div>
      </Dialog>

      <Dialog
        open={pendingDeleteSshProfile != null}
        title="确认删除"
        description={
          pendingDeleteSshProfile
            ? buildSshProfileDeleteDescription(
                pendingDeleteSshProfile,
                connections.filter((connection) => connection.sshProfileId === pendingDeleteSshProfile.id).length,
              )
            : ""
        }
        onClose={() => {
          if (!deletingSshProfile) {
            setPendingDeleteSshProfile(null);
          }
        }}
        onConfirm={submitDeleteSshProfileDialog}
        confirmDisabled={deletingSshProfile}
        footer={
          <>
            <Button variant="outline" disabled={deletingSshProfile} onClick={() => setPendingDeleteSshProfile(null)}>
              取消
            </Button>
            <Button variant="destructive" disabled={deletingSshProfile} onClick={() => void submitDeleteSshProfileDialog()}>
              {deletingSshProfile ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              删除
            </Button>
          </>
        }
      >
        <div className="text-sm leading-7 text-slate-600">删除后不可恢复。</div>
      </Dialog>
    </div>
  );
}
