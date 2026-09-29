import { useRef } from "react";
import {
  CirclePlus,
  Database,
  Download,
  PanelLeftClose,
  Pencil,
  Trash2,
  Upload,
  Zap,
} from "lucide-react";
import type { ConnectionProfile, SshProfile } from "../../types/connections";
import { Button } from "../ui/button";

export type ConnectionsSidebarPanelProps = {
  connections: ConnectionProfile[];
  currentConnectionId: string | null;
  testingConnectionId: string | null;
  getSshProfileForConnection: (connection: ConnectionProfile) => SshProfile | null;
  onCreateConnection: () => void;
  onExportClick: () => void;
  onImportFileSelected: (file: File) => void;
  onOpenConnection: (connectionId: string) => void;
  onTestConnection: (connection: ConnectionProfile) => void;
  onEditConnection: (connection: ConnectionProfile) => void;
  onDeleteConnection: (connection: ConnectionProfile) => void;
  onClose?: () => void;
  closeTitle?: string;
  className?: string;
};

export function ConnectionsSidebarPanel({
  connections,
  currentConnectionId,
  testingConnectionId,
  getSshProfileForConnection,
  onCreateConnection,
  onExportClick,
  onImportFileSelected,
  onOpenConnection,
  onTestConnection,
  onEditConnection,
  onDeleteConnection,
  onClose,
  closeTitle = "隐藏侧边栏",
  className = "flex h-full min-h-0 flex-col overflow-hidden",
}: ConnectionsSidebarPanelProps) {
  const importInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className={className}>
      <div className="mb-5 flex flex-col gap-4 border-b border-[#27304f] pb-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#8ba2ff]/70 bg-[#8ba2ff]/10 text-[#8ba2ff]">
              <Database className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="text-base font-semibold leading-tight text-white">ESX</h1>
              <p className="mt-0.5 text-[10px] text-[#8b90a3]">连接管理</p>
            </div>
          </div>
          {onClose ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 rounded-md px-2 text-xs text-[#b5b6c0] hover:bg-white/10 hover:text-white"
              title={closeTitle}
              aria-label={closeTitle}
              onClick={onClose}
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        <Button
          size="sm"
          className="mb-3 h-10 w-full justify-start rounded-md border border-[#8ba2ff] bg-[#8ba2ff] px-3 text-xs font-medium text-[#13182d] shadow-none hover:bg-[#a7b7ff] hover:shadow-none"
          onClick={onCreateConnection}
        >
          <CirclePlus className="mr-2 h-4 w-4" />
          新建连接
        </Button>
        <div className="flex gap-2 border-b border-[#27304f] pb-4">
          <Button
            variant="outline"
            size="sm"
            className="h-8 flex-1 rounded-md border-[#46506a] bg-transparent px-2 text-xs text-[#dfe5ef] shadow-none hover:bg-white/10 hover:text-white"
            onClick={() => importInputRef.current?.click()}
          >
            <Upload className="mr-1 h-3.5 w-3.5" />
            导入
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) {
                onImportFileSelected(file);
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 flex-1 rounded-md border-[#46506a] bg-transparent px-2 text-xs text-[#dfe5ef] shadow-none hover:bg-white/10 hover:text-white"
            disabled={connections.length === 0}
            onClick={onExportClick}
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            导出
          </Button>
        </div>

        <p className="mt-5 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8b90a3]">已保存连接</p>

        <div className="mt-2">
          {connections.length === 0 ? (
            <div className="rounded-md border border-dashed border-[#46506a] bg-white/5 p-3 text-xs leading-5 text-[#b5b6c0]">
              <p className="font-medium text-[#dfe5ef]">还没有任何连接</p>
              <p>点击「新建连接」后，连接会直接出现在这里。</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {connections.map((connection) => {
                const isCurrent = currentConnectionId === connection.id;
                const isTesting = testingConnectionId === connection.id;
                const sshProfile = getSshProfileForConnection(connection);

                return (
                  <div
                    key={connection.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${connection.name}，打开 Console`}
                    className={`cursor-pointer rounded-md border p-3 text-xs transition-colors ${
                      isCurrent
                        ? "border-[#8ba2ff]/60 bg-[#465282]/60 text-white shadow-[inset_3px_0_0_#8ba2ff]"
                        : "border-[#27304f] bg-white/[0.03] text-[#dfe5ef] hover:border-[#8ba2ff]/30 hover:bg-white/[0.08]"
                    }`}
                    onClick={() => onOpenConnection(connection.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenConnection(connection.id);
                      }
                    }}
                  >
                    <p className="truncate text-[13px] font-medium leading-snug">{connection.name}</p>
                    <p className={`mt-1 truncate font-mono text-[10px] ${isCurrent ? "text-[#b8c5ff]" : "text-[#8b90a3]"}`}>
                      {connection.baseUrl}
                    </p>
                    {connection.insecureTls || sshProfile ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {connection.insecureTls ? (
                          <span className="rounded bg-amber-300/15 px-1.5 py-px text-[9px] font-medium text-amber-200">
                            自签名 TLS
                          </span>
                        ) : null}
                        {sshProfile ? (
                          <span className="rounded bg-[#8ba2ff]/15 px-1.5 py-px text-[9px] font-medium text-[#b8c5ff]">
                            SSH 通道
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="mt-2 flex justify-end gap-0.5 border-t border-[#46506a]/50 pt-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded px-2 text-[10px] text-[#c9d3eb] hover:bg-white/10 hover:text-white"
                        aria-label="测试"
                        disabled={isTesting}
                        onKeyDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          onTestConnection(connection);
                        }}
                      >
                        <Zap className="mr-1 h-3.5 w-3.5" />
                        {isTesting ? "测试中" : "测试"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 rounded px-0 text-[#c9d3eb] hover:bg-white/10 hover:text-white"
                        title="编辑"
                        aria-label="编辑"
                        onKeyDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          onEditConnection(connection);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 rounded px-0 text-[#ff9aac] hover:bg-[#ff6280]/10 hover:text-[#ffb5c2]"
                        title="删除"
                        aria-label="删除"
                        onKeyDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteConnection(connection);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
