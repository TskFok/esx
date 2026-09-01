import { useRef } from "react";
import {
  CirclePlus,
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
      <div className="mb-3 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">ESX Console</p>
            <h1 className="mt-0.5 text-lg font-bold leading-tight">连接管理</h1>
          </div>
          {onClose ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 rounded-lg px-2 text-xs text-slate-200 hover:bg-white/10 hover:text-white"
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
        <div className="flex flex-wrap gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-lg px-2 text-xs"
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
            className="h-8 rounded-lg px-2 text-xs"
            disabled={connections.length === 0}
            onClick={onExportClick}
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            导出
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-lg px-2 text-xs"
            onClick={onCreateConnection}
          >
            <CirclePlus className="mr-1 h-3.5 w-3.5" />
            新建连接
          </Button>
        </div>

        <p className="mt-3 text-xs font-semibold text-slate-300">已保存连接</p>

        <div className="mt-2">
          {connections.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-white/5 p-2 text-xs leading-5 text-slate-400">
              <p className="font-semibold text-slate-300">还没有任何连接</p>
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
                    className={`cursor-pointer rounded-lg border p-2 text-xs transition ${
                      isCurrent
                        ? "border-white/30 bg-white text-slate-950"
                        : "border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                    }`}
                    onClick={() => onOpenConnection(connection.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenConnection(connection.id);
                      }
                    }}
                  >
                    <p className="truncate font-bold leading-snug">{connection.name}</p>
                    <p className={`mt-1 truncate text-[10px] ${isCurrent ? "text-slate-600" : "text-slate-400"}`}>
                      {connection.baseUrl}
                    </p>
                    {connection.insecureTls || sshProfile ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {connection.insecureTls ? (
                          <span className="rounded-full bg-amber-100 px-1.5 py-px text-[9px] font-semibold text-amber-800">
                            自签名 TLS
                          </span>
                        ) : null}
                        {sshProfile ? (
                          <span className="rounded-full bg-sky-100 px-1.5 py-px text-[9px] font-semibold text-sky-800">
                            SSH 通道
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="mt-1.5 flex justify-end gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[10px] text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
                        className="h-7 w-7 px-0 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
                        className="h-7 w-7 px-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
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
