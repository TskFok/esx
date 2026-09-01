import { useMutation } from "@tanstack/react-query";
import { Loader2, PanelLeftOpen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { ConnectionEditorPanel } from "../components/connections/connection-editor-panel";
import { ConnectionExportDialog } from "../components/connections/connection-export-dialog";
import { ConnectionImportDialog } from "../components/connections/connection-import-dialog";
import { ConnectionsSidebarPanel } from "../components/connections/connections-sidebar-panel";
import { SshProfileDialog } from "../components/connections/ssh-profile-dialog";
import { ConsoleMobileDrawer } from "../components/console/console-mobile-drawer";
import { Dialog } from "../components/ui/dialog";
import {
  getAuthSecretFromForm,
  validateConnectionSecurity,
  validateSshHostKey,
} from "../lib/connection-security";
import { buildSshTunnelConfig, getSshSecretFromForm } from "../lib/connections";
import {
  defaultConnectionForm,
  defaultSshForm,
  getConnectionEditorLeaveBehavior,
  isConnectionFormDirty,
  isConnectionFormIncomplete,
  isSshFormIncomplete,
  type ConnectionEditorLeaveReason,
  type ConnectionEditorMode,
} from "../lib/connection-form";
import { CONSOLE_WORKSPACE_PATH } from "../lib/console-error-logs-panel";
import { CONSOLE_SIDEBAR_WIDTH_DEFAULT } from "../lib/console-sidebar";
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
  decryptConnectionExportFile,
  encryptConnectionExportPayload,
  isEncryptedConnectionExportFile,
  serializeEncryptedConnectionExportFile,
  type ConnectionExportPayload,
} from "../lib/connection-import-export";
import { testConnection } from "../lib/http-client";
import { downloadExportContent } from "../lib/request-import-export";
import { validateSshTunnel } from "../lib/tauri";
import { useAppState } from "../providers/app-state";
import type {
  ConnectionFormValues,
  ConnectionProfile,
  SshProfile,
} from "../types/connections";

const zhNameSorter = new Intl.Collator("zh-CN");

type PendingLeave = {
  reason: Exclude<ConnectionEditorLeaveReason, "open-console">;
  mode: ConnectionEditorMode;
  connection?: ConnectionProfile;
};

function compareConnections(left: ConnectionProfile, right: ConnectionProfile) {
  return right.lastUsedAt.localeCompare(left.lastUsedAt) || zhNameSorter.compare(left.name, right.name);
}

function buildConnectionFormValues(
  connection: ConnectionProfile,
  password: string | null,
): ConnectionFormValues {
  const authType = connection.auth?.type ?? "basic";
  return {
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
  };
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
    importConnections,
    getPassword,
    getSshSecret,
    getSshProfileForConnection,
    recordErrorLog,
  } = useAppState();
  const [editorMode, setEditorMode] = useState<ConnectionEditorMode>("idle");
  const [formSnapshot, setFormSnapshot] = useState(defaultConnectionForm);
  const [pendingLeave, setPendingLeave] = useState<PendingLeave | null>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [isLgSplit, setIsLgSplit] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );
  const [sshDialogOpen, setSshDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ConnectionProfile | null>(null);
  const [editingSshProfile, setEditingSshProfile] = useState<SshProfile | null>(null);
  const [connectionFormValues, setConnectionFormValues] = useState<ConnectionFormValues>(defaultConnectionForm);
  const [sshFormValues, setSshFormValues] = useState(defaultSshForm);
  const [testingConnectionId, setTestingConnectionId] = useState<string | null>(null);
  const [testingSshProfileId, setTestingSshProfileId] = useState<string | null>(null);
  const [pendingDeleteConnection, setPendingDeleteConnection] = useState<ConnectionProfile | null>(null);
  const [deletingConnection, setDeletingConnection] = useState(false);
  const [pendingDeleteSshProfile, setPendingDeleteSshProfile] = useState<SshProfile | null>(null);
  const [deletingSshProfile, setDeletingSshProfile] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importParsing, setImportParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    rawJson: unknown;
    payload: ConnectionExportPayload | null;
  } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsLgSplit(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

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

  const editorDirty = isConnectionFormDirty(connectionFormValues, formSnapshot);

  const sshSaveMutation = useMutation({
    mutationFn: async (payload: typeof sshFormValues) => {
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
      setEditorMode("idle");
      setEditingConnection(null);
      setConnectionFormValues(defaultConnectionForm);
      setFormSnapshot(defaultConnectionForm);
      navigate(CONSOLE_WORKSPACE_PATH);
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

  function resetEditorToIdle() {
    setEditorMode("idle");
    setEditingConnection(null);
    setConnectionFormValues(defaultConnectionForm);
    setFormSnapshot(defaultConnectionForm);
  }

  function applyEditorDestination(next: PendingLeave) {
    if (next.mode === "create") {
      setEditingConnection(null);
      setConnectionFormValues(defaultConnectionForm);
      setFormSnapshot(defaultConnectionForm);
      setEditorMode("create");
      return;
    }
    if (next.mode === "edit" && next.connection) {
      void loadConnectionIntoEditor(next.connection);
      return;
    }
    resetEditorToIdle();
  }

  function requestEditorLeave(next: PendingLeave) {
    const behavior = getConnectionEditorLeaveBehavior({
      isDirty: editorDirty,
      savePending: saveMutation.isPending,
      reason: next.reason,
    });
    if (behavior === "block") {
      return;
    }
    if (behavior === "confirm") {
      setPendingLeave(next);
      return;
    }
    applyEditorDestination(next);
  }

  function openCreateConnection() {
    requestEditorLeave({ reason: "switch-editor", mode: "create" });
  }

  function openEditConnection(connection: ConnectionProfile) {
    requestEditorLeave({ reason: "switch-editor", mode: "edit", connection });
  }

  function handleCancelEditor() {
    requestEditorLeave({ reason: "cancel", mode: "idle" });
  }

  function confirmPendingLeave() {
    if (!pendingLeave) {
      return;
    }
    const next = pendingLeave;
    setPendingLeave(null);
    applyEditorDestination(next);
  }

  async function loadConnectionIntoEditor(connection: ConnectionProfile) {
    const password = await getPassword(connection);
    const nextValues = buildConnectionFormValues(connection, password);
    setEditingConnection(connection);
    setConnectionFormValues(nextValues);
    setFormSnapshot(nextValues);
    setEditorMode("edit");
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
      if (editingConnection?.id === pendingDeleteConnection.id) {
        resetEditorToIdle();
      }
      toast.success("连接已删除。");
      setPendingDeleteConnection(null);
    } catch (error) {
      toast.error(extractUnknownErrorMessage(error, "删除连接失败"));
    } finally {
      setDeletingConnection(false);
    }
  }

  function handleOpenConnection(connectionId: string) {
    const behavior = getConnectionEditorLeaveBehavior({
      isDirty: editorDirty,
      savePending: saveMutation.isPending,
      reason: "open-console",
    });
    if (behavior === "block") {
      return;
    }
    setCurrentConnection(connectionId);
    navigate(CONSOLE_WORKSPACE_PATH);
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

  async function handleImportFileSelected(file: File) {
    try {
      const rawJson = JSON.parse(await file.text());
      if (!isEncryptedConnectionExportFile(rawJson)) {
        throw new Error("不支持的连接导入文件。");
      }

      setPendingImport({
        fileName: file.name,
        rawJson,
        payload: null,
      });
      setImportError(null);
      setImportDialogOpen(true);
    } catch (error) {
      toast.error(extractUnknownErrorMessage(error, "无法读取导入文件"));
    }
  }

  async function handleParseImportFile(password: string) {
    if (!pendingImport) {
      return;
    }

    setImportParsing(true);
    setImportError(null);
    try {
      if (!isEncryptedConnectionExportFile(pendingImport.rawJson)) {
        throw new Error("不支持的连接导入文件。");
      }
      const payload = await decryptConnectionExportFile(pendingImport.rawJson, password);
      setPendingImport((current) => (current ? { ...current, payload } : current));
    } catch (error) {
      setImportError(extractUnknownErrorMessage(error, "导入文件解析失败"));
    } finally {
      setImportParsing(false);
    }
  }

  async function handleConfirmImport() {
    if (!pendingImport?.payload) {
      return;
    }

    setImporting(true);
    setImportError(null);
    try {
      const result = await importConnections(pendingImport.payload);
      setImportDialogOpen(false);
      setPendingImport(null);
      toast.success(`已导入 ${result.connectionsImported} 条连接和 ${result.sshProfilesImported} 条 SSH 通道。`);
    } catch (error) {
      setImportError(extractUnknownErrorMessage(error, "导入连接失败"));
    } finally {
      setImporting(false);
    }
  }

  const sidebarPanel = (
    <ConnectionsSidebarPanel
      connections={sortedConnections}
      currentConnectionId={currentConnection?.id ?? null}
      testingConnectionId={testingConnectionId}
      getSshProfileForConnection={getSshProfileForConnection}
      onCreateConnection={openCreateConnection}
      onExportClick={() => setExportDialogOpen(true)}
      onImportFileSelected={(file) => {
        void handleImportFileSelected(file);
      }}
      onOpenConnection={handleOpenConnection}
      onTestConnection={(item) => {
        void runSavedConnectionTest(item);
      }}
      onEditConnection={openEditConnection}
      onDeleteConnection={handleDeleteConnection}
    />
  );

  return (
    <div className="h-dvh overflow-hidden p-4 sm:p-6">
      <div className="flex h-full min-h-0 gap-3 lg:flex-row">
        <aside
          className="hidden min-h-0 shrink-0 flex-col overflow-hidden rounded-2xl bg-slate-950 px-3 py-3 text-slate-50 shadow-xl shadow-slate-900/25 lg:flex"
          style={{ width: CONSOLE_SIDEBAR_WIDTH_DEFAULT }}
        >
          {sidebarPanel}
        </aside>
        <ConsoleMobileDrawer
          open={mobileDrawerOpen && !isLgSplit}
          onClose={() => setMobileDrawerOpen(false)}
          closeLabel="关闭连接列表"
        >
          {sidebarPanel}
        </ConsoleMobileDrawer>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!isLgSplit ? (
            <Button variant="outline" className="mb-3 shrink-0 self-start" onClick={() => setMobileDrawerOpen(true)}>
              <PanelLeftOpen className="mr-2 h-4 w-4" />
              连接列表
            </Button>
          ) : null}
          <div className="min-h-0 flex-1">
            <ConnectionEditorPanel
              mode={editorMode}
              values={connectionFormValues}
              sshProfiles={sortedSshProfiles}
              selectedSshProfile={selectedSshProfile}
              saving={saveMutation.isPending}
              incomplete={isConnectionFormIncomplete(connectionFormValues)}
              testingSshProfileId={testingSshProfileId}
              onCreate={openCreateConnection}
              onCancel={handleCancelEditor}
              onSave={() => saveMutation.mutate(connectionFormValues)}
              onChange={setConnectionFormValues}
              onCreateSsh={openCreateSshDialog}
              onEditSsh={(profile) => {
                void openEditSshDialog(profile);
              }}
              onTestSsh={(profile) => {
                void runSavedSshProfileTest(profile);
              }}
              onDeleteSsh={handleDeleteSshProfile}
            />
          </div>
        </main>
      </div>

      <SshProfileDialog
        open={sshDialogOpen}
        title={editingSshProfile ? "编辑 SSH 通道" : "新增 SSH 通道"}
        values={sshFormValues}
        saving={sshSaveMutation.isPending}
        incomplete={isSshFormIncomplete(sshFormValues)}
        onClose={() => {
          if (sshSaveMutation.isPending) {
            return;
          }
          setSshDialogOpen(false);
        }}
        onChange={setSshFormValues}
        onSave={() => sshSaveMutation.mutate(sshFormValues)}
      />

      <ConnectionExportDialog
        open={exportDialogOpen}
        connectionCount={sortedConnections.length}
        sshProfileCount={sortedSshProfiles.length}
        exporting={exporting}
        onClose={() => {
          if (!exporting) {
            setExportDialogOpen(false);
          }
        }}
        onConfirm={handleConfirmExport}
      />

      <ConnectionImportDialog
        open={importDialogOpen}
        fileName={pendingImport?.fileName ?? ""}
        payload={pendingImport?.payload ?? null}
        errorMessage={importError}
        parsing={importParsing}
        importing={importing}
        onClose={() => {
          if (!importParsing && !importing) {
            setImportDialogOpen(false);
            setPendingImport(null);
            setImportError(null);
          }
        }}
        onParse={handleParseImportFile}
        onConfirm={handleConfirmImport}
      />

      <Dialog
        open={pendingLeave != null}
        title="放弃未保存的更改？"
        description="离开后，当前表单里尚未保存的修改会丢失。"
        onClose={() => setPendingLeave(null)}
        onConfirm={confirmPendingLeave}
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingLeave(null)}>
              继续编辑
            </Button>
            <Button onClick={confirmPendingLeave}>放弃更改</Button>
          </>
        }
      >
        <div className="text-sm leading-7 text-slate-600">确认放弃后，会执行刚才的操作。</div>
      </Dialog>

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
