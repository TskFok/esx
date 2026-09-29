import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Braces,
  Boxes,
  Code2,
  GitCompare,
  Layers3,
  Loader2,
  PanelRightClose,
  Play,
  RefreshCcw,
  Route,
  Send,
  Settings2,
  ShieldAlert,
  Trash2,
  Workflow,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { getSshTunnelForProfile } from "../../lib/connection-security";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  buildAdminRequestPreview,
  buildAliasSwitchOperation,
  buildAnalyzeOperation,
  buildCreateIndexOperation,
  buildDeleteNamedResourceOperation,
  buildForceMergeOperation,
  buildGetIndexMappingOperation,
  buildGetIndexSettingsOperation,
  buildIndexStateOperation,
  buildMappingDiff,
  buildPutComponentTemplateOperation,
  buildPutIndexTemplateOperation,
  buildPutIngestPipelineOperation,
  buildReindexOperation,
  buildRolloverOperation,
  buildRuntimeFieldsSearchOperation,
  buildSetIndexWriteBlockOperation,
  buildShrinkSplitOperation,
  buildSimulateIndexTemplateOperation,
  buildSimulatePipelineOperation,
  buildTaskLookupOperation,
  buildUpdateIndexSettingsOperation,
  parseAnalyzeTokens,
} from "../../lib/admin-operations";
import { parseConsoleRequest } from "../../lib/console-parser";
import { paginate } from "../../lib/paginate";
import { buildConnectionLogContextFromProfile, buildRequestLogContext } from "../../lib/error-logs";
import { extractUnknownErrorMessage, getResponseErrorMessage } from "../../lib/errors";
import { executeAdminOperation } from "../../lib/http-client";
import { classifyRequestSafety } from "../../lib/request-safety";
import { buildResponseSnapshot } from "../../lib/response-snapshot";
import { formatShanghaiDateTime } from "../../lib/time";
import { cn } from "../../lib/utils";
import { useAppActions, useAppStateField } from "../../providers/app-state";
import type { AdminExecutionResult, AdminOperation, AdminOperationGroup, AdminRequestPreview, MappingDiffResult } from "../../types/admin";
import type { ConnectionProfile } from "../../types/connections";

type AdminSection = AdminOperationGroup;

type AdminResource = {
  id: string;
  kind: "index" | "alias" | "index-template" | "component-template" | "pipeline";
  name: string;
  detail: string;
};

const SECTION_LABELS: Record<AdminSection, string> = {
  indices: "索引治理",
  templates: "模板/管道",
  tools: "分析工具",
};

const SECTION_DESCRIPTIONS: Record<AdminSection, string> = {
  indices: "创建、打开、关闭、删除、settings、mapping、alias、rollover、reindex、shrink/split。",
  templates: "管理 composable index template、component template、ingest pipeline，并支持 simulate。",
  tools: "测试 analyzer/tokenizer、runtime fields、pipeline simulate 等建模辅助能力。",
};

const DEFAULT_CREATE_SETTINGS = `{
  "index.number_of_shards": 1,
  "index.number_of_replicas": 1
}`;

const DEFAULT_CREATE_MAPPINGS = `{
  "properties": {
    "created_at": { "type": "date" },
    "message": { "type": "text" }
  }
}`;

const DEFAULT_TEMPLATE = `{
  "settings": {
    "index.number_of_shards": 1
  },
  "mappings": {
    "properties": {
      "created_at": { "type": "date" }
    }
  }
}`;

const DEFAULT_PIPELINE = `{
  "processors": [
    { "set": { "field": "env", "value": "dev" } }
  ]
}`;

const DEFAULT_SIMULATE_DOCS = `{
  "docs": [
    { "_source": { "message": "hello" } }
  ]
}`;

const DEFAULT_RUNTIME_FIELDS = `{
  "day_of_week": {
    "type": "keyword",
    "script": {
      "source": "emit(doc['created_at'].value.dayOfWeekEnum.toString())"
    }
  }
}`;

function createReadOperation(input: {
  id: string;
  title: string;
  description: string;
  path: string;
  group?: AdminOperationGroup;
}): AdminOperation {
  return {
    id: input.id,
    group: input.group ?? "indices",
    title: input.title,
    description: input.description,
    method: "GET",
    path: input.path,
    bodyText: "",
  };
}

function parseJsonValue(bodyText: string) {
  if (!bodyText.trim()) {
    return null;
  }
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function parseResourcesFromResult(result: AdminExecutionResult): AdminResource[] {
  const value = parseJsonValue(result.bodyText);

  if (result.operation.id === "resources-indices" && Array.isArray(value)) {
    return value.flatMap((item) => {
      const record = asRecord(item);
      const name = asString(record?.index);
      if (!name) {
        return [];
      }
      return [{
        id: `index:${name}`,
        kind: "index" as const,
        name,
        detail: `${asString(record?.health) || "unknown"} · ${asString(record?.status) || "unknown"} · docs ${asString(record?.["docs.count"]) || "-"}`,
      }];
    });
  }

  if (result.operation.id === "resources-aliases" && Array.isArray(value)) {
    return value.flatMap((item) => {
      const record = asRecord(item);
      const name = asString(record?.alias);
      if (!name) {
        return [];
      }
      return [{
        id: `alias:${name}:${asString(record?.index)}`,
        kind: "alias" as const,
        name,
        detail: `${asString(record?.index) || "-"}${asString(record?.is_write_index) === "true" ? " · write" : ""}`,
      }];
    });
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  if (result.operation.id === "resources-index-templates" && Array.isArray(record.index_templates)) {
    return record.index_templates.flatMap((item) => {
      const entry = asRecord(item);
      const name = asString(entry?.name);
      const template = asRecord(entry?.index_template);
      const patterns = Array.isArray(template?.index_patterns) ? template.index_patterns.join(", ") : "-";
      return name ? [{ id: `index-template:${name}`, kind: "index-template" as const, name, detail: patterns }] : [];
    });
  }

  if (result.operation.id === "resources-component-templates" && Array.isArray(record.component_templates)) {
    return record.component_templates.flatMap((item) => {
      const entry = asRecord(item);
      const name = asString(entry?.name);
      return name ? [{ id: `component-template:${name}`, kind: "component-template" as const, name, detail: "component template" }] : [];
    });
  }

  if (result.operation.id === "resources-pipelines") {
    return Object.keys(record).sort((left, right) => left.localeCompare(right, "zh-CN")).map((name) => ({
      id: `pipeline:${name}`,
      kind: "pipeline" as const,
      name,
      detail: "ingest pipeline",
    }));
  }

  return [];
}

function resourceListOperations(section: AdminSection): AdminOperation[] {
  const indices = [
    createReadOperation({ id: "resources-indices", title: "读取索引列表", description: "读取 index 状态列表。", path: "/_cat/indices?format=json&bytes=b&expand_wildcards=all&h=index,health,status,docs.count,store.size,pri,rep" }),
    createReadOperation({ id: "resources-aliases", title: "读取 Alias 列表", description: "读取 alias 绑定。", path: "/_cat/aliases?format=json&h=alias,index,is_write_index" }),
  ];
  const templates = [
    createReadOperation({ id: "resources-index-templates", title: "读取 Index Template", description: "读取 composable index templates。", path: "/_index_template?filter_path=index_templates.name,index_templates.index_template.index_patterns", group: "templates" }),
    createReadOperation({ id: "resources-component-templates", title: "读取 Component Template", description: "读取 component templates。", path: "/_component_template?filter_path=component_templates.name", group: "templates" }),
    createReadOperation({ id: "resources-pipelines", title: "读取 Pipeline", description: "读取 ingest pipelines。", path: "/_ingest/pipeline", group: "templates" }),
  ];
  return section === "indices" ? indices : section === "templates" ? templates : [indices[0], templates[2]];
}

function resourceDetailOperation(resource: AdminResource): AdminOperation {
  const name = encodeURIComponent(resource.name);
  const path = resource.kind === "index" ? `/${name}` :
    resource.kind === "alias" ? `/_alias/${name}` :
    resource.kind === "index-template" ? `/_index_template/${name}` :
    resource.kind === "component-template" ? `/_component_template/${name}` : `/_ingest/pipeline/${name}`;
  return createReadOperation({ id: "resource-detail", title: `读取 ${resource.name} 详情`, description: "读取单项资源完整定义。", path, group: resource.kind === "index" || resource.kind === "alias" ? "indices" : "templates" });
}

function affectedResourceIds(operation: AdminOperation): Set<string> {
  const ids = new Set<string>();
  const segments = operation.path.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
  const [first, second, third] = segments;
  if (first === "_index_template" && second && second !== "_simulate") ids.add(`index-template:${second}`);
  if (first === "_component_template" && second) ids.add(`component-template:${second}`);
  if (first === "_ingest" && second === "pipeline" && third) ids.add(`pipeline:${third}`);
  if (first && !first.startsWith("_") && first !== "*" && operation.id !== "rollover") ids.add(`index:${first}`);
  if ((operation.id === "shrink" || operation.id === "split") && third) ids.add(`index:${third}`);
  if (operation.id === "rollover" && first) {
    ids.add(`alias:${first}:`);
    if (third) ids.add(`index:${third}`);
  }
  if (operation.id === "alias-switch") {
    const actions = asRecord(parseJsonValue(operation.bodyText))?.actions;
    if (Array.isArray(actions)) {
      for (const action of actions) {
        const entry = asRecord(asRecord(action)?.add ?? asRecord(action)?.remove);
        const alias = asString(entry?.alias);
        const index = asString(entry?.index);
        if (alias) ids.add(`alias:${alias}:`);
        if (index) ids.add(`index:${index}`);
      }
    }
  }
  if (operation.id === "reindex") {
    const body = asRecord(parseJsonValue(operation.bodyText));
    for (const name of [asString(asRecord(body?.source)?.index), asString(asRecord(body?.dest)?.index)]) {
      if (name) ids.add(`index:${name}`);
    }
  }
  return ids;
}

function parseListInput(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatResultBody(result: AdminExecutionResult | null) {
  if (!result) {
    return "";
  }
  const parsed = parseJsonValue(result.bodyText);
  return parsed ? JSON.stringify(parsed, null, 2) : result.bodyText;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function OperationCard({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="p-3 sm:p-4">
      <div className="flex items-start gap-2">
        <div className="rounded bg-secondary p-2 text-primary">{icon}</div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">{description}</p>
        </div>
      </div>
      <div className="mt-3 grid gap-2">{children}</div>
    </Card>
  );
}

function ResourceKindBadge({ kind }: { kind: AdminResource["kind"] }) {
  const labels: Record<AdminResource["kind"], string> = {
    index: "Index",
    alias: "Alias",
    "index-template": "Index Template",
    "component-template": "Component",
    pipeline: "Pipeline",
  };
  return (
    <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-px text-[10px] font-bold text-slate-600">
      {labels[kind]}
    </span>
  );
}

function RequestPreviewPanel({
  preview,
  execution,
  executing,
  onSendToConsole,
  onExecute,
}: {
  preview: AdminRequestPreview | null;
  execution: AdminExecutionResult | null;
  executing: boolean;
  onSendToConsole: () => void;
  onExecute: () => void;
}) {
  const tokens = execution?.operation.id === "analyze" ? parseAnalyzeTokens(execution.bodyText) : [];

  return (
    <Card className="sticky bottom-3 z-10 border-slate-200 bg-white p-3 sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">请求预览与执行结果</h2>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">
            所有向导都会先生成 Console 请求，可发送到 Console 审阅，也可在此直接执行。
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button variant="outline" size="sm" className="px-2.5 text-xs" disabled={!preview} onClick={onSendToConsole}>
            <Send className="mr-1 h-3.5 w-3.5" />
            发送到 Console
          </Button>
          <Button size="sm" className="px-2.5 text-xs" disabled={!preview || executing} onClick={onExecute}>
            {executing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
            直接执行
          </Button>
        </div>
      </div>

      {preview ? (
        <pre className="mt-3 max-h-56 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">
          {preview.content}
        </pre>
      ) : (
        <div className="mt-3 rounded-md border border-dashed border-slate-200 bg-background p-3 text-xs text-slate-500">
          选择一个向导并生成请求后，这里会显示完整 Console 请求。
        </div>
      )}

      {execution ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-background p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-bold",
              execution.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700",
            )}>
              {execution.status || "FAILED"} {execution.statusText}
            </span>
            <span className="text-xs text-slate-500">{execution.durationMs} ms · {formatShanghaiDateTime(execution.executedAt)}</span>
          </div>
          {tokens.length > 0 ? (
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-[520px] text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 pr-3">Token</th>
                    <th className="py-1 pr-3">Position</th>
                    <th className="py-1 pr-3">Offset</th>
                    <th className="py-1 pr-3">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token, index) => (
                    <tr key={`${token.token}:${index}`} className="border-t border-slate-200">
                      <td className="py-1 pr-3 font-bold text-slate-900">{token.token}</td>
                      <td className="py-1 pr-3 text-slate-600">{token.position}</td>
                      <td className="py-1 pr-3 text-slate-600">{token.startOffset}-{token.endOffset}</td>
                      <td className="py-1 pr-3 text-slate-600">{token.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <pre className="mt-2 max-h-52 overflow-auto rounded-lg bg-white p-2 text-xs leading-5 text-slate-700">
            {formatResultBody(execution)}
          </pre>
        </div>
      ) : null}
    </Card>
  );
}

export type AdminPanelProps = {
  onClose: () => void;
  closeTitle?: string;
  className?: string;
};

type ExecutionInput = {
  operation: AdminOperation;
  connection: ConnectionProfile;
  logContext: ReturnType<typeof buildConnectionLogContextFromProfile>;
};

export function AdminPanel({
  onClose,
  closeTitle = "关闭治理",
  className = "flex h-full min-h-0 flex-col overflow-hidden",
}: AdminPanelProps) {
  const currentConnection = useAppStateField("currentConnection");
  const {
    updateDraft,
    getPassword,
    getSshSecret,
    getSshProfileForConnection,
    recordErrorLog,
    recordAuditLog,
  } = useAppActions();
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState<AdminSection>("indices");
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [resourcePage, setResourcePage] = useState(1);
  const [mappingPage, setMappingPage] = useState(1);
  const [preview, setPreview] = useState<AdminRequestPreview | null>(null);
  const [execution, setExecution] = useState<AdminExecutionResult | null>(null);
  const [mappingDiff, setMappingDiff] = useState<MappingDiffResult | null>(null);

  const [indexName, setIndexName] = useState("my-index");
  const [createSettingsJson, setCreateSettingsJson] = useState(DEFAULT_CREATE_SETTINGS);
  const [createMappingsJson, setCreateMappingsJson] = useState(DEFAULT_CREATE_MAPPINGS);
  const [settingsJson, setSettingsJson] = useState('{\n  "index.refresh_interval": "30s"\n}');
  const [aliasName, setAliasName] = useState("my-index-write");
  const [aliasRemoveIndices, setAliasRemoveIndices] = useState("my-index-v1");
  const [aliasAddIndices, setAliasAddIndices] = useState("my-index-v2");
  const [aliasWriteIndex, setAliasWriteIndex] = useState("my-index-v2");
  const [rolloverAlias, setRolloverAlias] = useState("my-index-write");
  const [rolloverNewIndex, setRolloverNewIndex] = useState("my-index-000002");
  const [rolloverConditionsJson, setRolloverConditionsJson] = useState('{\n  "conditions": {\n    "max_docs": 1000000,\n    "max_age": "7d"\n  }\n}');
  const [reindexSource, setReindexSource] = useState("my-index-v1");
  const [reindexTarget, setReindexTarget] = useState("my-index-v2");
  const [reindexQueryJson, setReindexQueryJson] = useState("");
  const [taskId, setTaskId] = useState("");
  const [targetShards, setTargetShards] = useState("1");
  const [mappingLeftIndex, setMappingLeftIndex] = useState("my-index-v1");
  const [mappingRightIndex, setMappingRightIndex] = useState("my-index-v2");

  const [indexTemplateName, setIndexTemplateName] = useState("my-template");
  const [indexPatterns, setIndexPatterns] = useState("my-index-*");
  const [componentTemplates, setComponentTemplates] = useState("");
  const [templateJson, setTemplateJson] = useState(DEFAULT_TEMPLATE);
  const [componentTemplateName, setComponentTemplateName] = useState("my-component");
  const [componentTemplateJson, setComponentTemplateJson] = useState(DEFAULT_TEMPLATE);
  const [pipelineName, setPipelineName] = useState("my-pipeline");
  const [pipelineJson, setPipelineJson] = useState(DEFAULT_PIPELINE);
  const [simulateDocsJson, setSimulateDocsJson] = useState(DEFAULT_SIMULATE_DOCS);

  const [analyzeIndex, setAnalyzeIndex] = useState("my-index");
  const [analyzer, setAnalyzer] = useState("standard");
  const [tokenizer, setTokenizer] = useState("");
  const [analyzeText, setAnalyzeText] = useState("Quick brown fox");
  const [runtimeIndex, setRuntimeIndex] = useState("my-index");
  const [runtimeFieldsJson, setRuntimeFieldsJson] = useState(DEFAULT_RUNTIME_FIELDS);
  const [runtimeQueryJson, setRuntimeQueryJson] = useState("");

  const connection = currentConnection;
  const currentConnectionRef = useRef(connection);
  currentConnectionRef.current = connection;
  const resourceQueryKey = ["admin-resources", connection?.id, connection?.updatedAt, activeSection] as const;
  const resourcesQuery = useQuery({
    queryKey: resourceQueryKey,
    enabled: Boolean(connection),
    queryFn: async () => {
      const operations = resourceListOperations(activeSection);
      const results = await Promise.allSettled(operations.map((operation) => runAdminOperation(operation)));
      const resources: AdminResource[] = [];
      const partialFailures: string[] = [];
      for (const [index, settled] of results.entries()) {
        const operation = operations[index];
        if (settled.status === "rejected") {
          partialFailures.push(`${operation.title}：${extractUnknownErrorMessage(settled.reason, "请求失败")}`);
        } else if (!settled.value.ok) {
          partialFailures.push(`${operation.title}：${settled.value.status} ${settled.value.statusText}`);
        } else {
          resources.push(...parseResourcesFromResult(settled.value));
        }
      }
      if (partialFailures.length === operations.length) {
        throw new Error(partialFailures.join("；"));
      }
      return { resources, partialFailures };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const visibleResources = resourcesQuery.data?.resources ?? [];
  const selectedResource = visibleResources.find((resource) => resource.id === selectedResourceId) ?? null;
  const resourcePageData = paginate(visibleResources, resourcePage);
  const mappingPageData = paginate(mappingDiff?.entries ?? [], mappingPage);
  const detailQuery = useQuery({
    queryKey: [...resourceQueryKey, selectedResource?.id],
    enabled: Boolean(connection && selectedResource),
    queryFn: async () => {
      if (!selectedResource) throw new Error("未选择资源。");
      const result = await runAdminOperation(resourceDetailOperation(selectedResource));
      if (!result.ok) throw new Error(getResponseErrorMessage(buildResponseSnapshot(result), "资源详情读取失败，请检查连接权限。"));
      return formatResultBody(result);
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  function setOperation(operation: AdminOperation) {
    setPreview(buildAdminRequestPreview(operation));
    setExecution(null);
  }

  function generate(operationFactory: () => AdminOperation) {
    try {
      setOperation(operationFactory());
    } catch (error) {
      toast.error(extractUnknownErrorMessage(error, "生成请求失败"));
    }
  }

  async function runAdminOperation(operation: AdminOperation, connectionOverride?: ConnectionProfile) {
    const targetConnection = connectionOverride ?? connection;
    if (!targetConnection) {
      throw new Error("当前没有可用连接。");
    }

    const sshProfile = getSshProfileForConnection(targetConnection);
    const [password, sshSecret] = await Promise.all([getPassword(targetConnection), getSshSecret(sshProfile)]);
    if (!password) {
      throw new Error("当前连接未找到已保存密码，请回到连接页重新保存。");
    }

    return executeAdminOperation(targetConnection, { password, sshSecret }, operation, getSshTunnelForProfile(sshProfile));
  }

  const executeMutation = useMutation({
    mutationFn: async ({ operation, connection: sourceConnection }: ExecutionInput) => {
      const requestPreview = buildAdminRequestPreview(operation);
      const parsed = parseConsoleRequest(requestPreview.content);
      const safety = classifyRequestSafety(parsed, sourceConnection);
      if (safety.blocked) {
        throw new Error(`请求被阻断：${safety.reasons.join(" ")}`);
      }
      if (safety.requiresConfirmation) {
        const confirmed = window.confirm(
          `${operation.title} 被识别为 ${safety.level === "destructive" ? "高危破坏性操作" : "管理操作"}。\n\n${safety.reasons.join("\n")}\n\n确认继续执行？`,
        );
        if (!confirmed) {
          throw new Error("已取消执行高风险请求。");
        }
      }

      return runAdminOperation(operation, sourceConnection);
    },
    onSuccess(result, { connection: sourceConnection, logContext }) {
      if (currentConnectionRef.current?.id === sourceConnection.id && currentConnectionRef.current.updatedAt === sourceConnection.updatedAt) {
        setExecution(result);
      }
      const requestPreview = buildAdminRequestPreview(result.operation);
      const snapshot = buildResponseSnapshot({
        ok: result.ok,
        status: result.status,
        statusText: result.statusText,
        durationMs: result.durationMs,
        executedAt: result.executedAt,
        bodyText: result.bodyText,
        diagnostics: result.diagnostics,
      });

      if (!result.ok) {
        const message = getResponseErrorMessage(snapshot, "治理操作执行失败");
        toast.error(message);
        recordErrorLog({
          scope: "request-execution",
          title: "治理操作执行失败",
          summary: message,
          diagnostics: result.diagnostics,
          status: result.status,
          rawResponse: result.bodyText,
          connection: logContext,
          request: buildRequestLogContext(requestPreview.content),
        });
        return;
      }

      const safety = classifyRequestSafety(parseConsoleRequest(requestPreview.content), sourceConnection);
      if (safety.auditOnSuccess) {
        recordAuditLog({
          scope: "request-audit",
          title: "治理操作执行成功",
          summary: `${result.operation.title} 执行成功：${result.operation.method} ${result.operation.path}`,
          diagnostics: safety.reasons,
          status: result.status,
          rawResponse: result.bodyText,
          connection: logContext,
          request: buildRequestLogContext(requestPreview.content),
        });
      }

      toast.success("治理操作已执行。");
      if (result.operation.method !== "GET" && result.operation.group !== "tools" && result.operation.id !== "index-template-simulate" && !result.operation.path.includes("dry_run=true")) {
        const affectedSections: AdminSection[] = result.operation.group === "templates" ? ["templates", "tools"] : ["indices", "tools"];
        const affectedIds = affectedResourceIds(result.operation);
        for (const section of affectedSections) {
          const key = ["admin-resources", sourceConnection.id, sourceConnection.updatedAt, section];
          void queryClient.invalidateQueries({ queryKey: key, exact: true });
          if (affectedIds.size > 0) {
            void queryClient.invalidateQueries({
              predicate: (query) => query.queryKey.length === 5 && query.queryKey.slice(0, 4).every((value, index) => value === key[index]) &&
                [...affectedIds].some((id) => id.endsWith(":") ? String(query.queryKey[4]).startsWith(id) : query.queryKey[4] === id),
            });
          }
        }
      }
    },
    onError(error, { operation, logContext }) {
      const message = extractUnknownErrorMessage(error, "治理操作执行失败");
      toast.error(message);
      recordErrorLog({
        scope: "request-execution",
        title: "治理操作执行失败",
        summary: message,
        diagnostics: [],
        connection: logContext,
        request: buildRequestLogContext(buildAdminRequestPreview(operation).content),
      });
    },
  });

  async function fetchMappingDiff() {
    try {
      const [left, right] = await Promise.all([
        runAdminOperation(buildGetIndexMappingOperation(mappingLeftIndex)),
        runAdminOperation(buildGetIndexMappingOperation(mappingRightIndex)),
      ]);
      if (!left.ok || !right.ok) {
        throw new Error("Mapping 拉取失败，请检查索引名称和权限。");
      }
      setMappingDiff(buildMappingDiff({
        leftName: mappingLeftIndex,
        rightName: mappingRightIndex,
        leftMapping: parseJsonValue(left.bodyText),
        rightMapping: parseJsonValue(right.bodyText),
      }));
      setMappingPage(1);
      toast.success("Mapping 差异已生成。");
    } catch (error) {
      toast.error(extractUnknownErrorMessage(error, "Mapping 差异生成失败"));
    }
  }

  function sendPreviewToConsole() {
    if (!preview || !connection) {
      return;
    }
    updateDraft(connection.id, (draft) => ({
      ...draft,
      name: preview.title,
      content: preview.content,
      activeSavedRequestId: null,
      response: null,
    }));
    onClose();
  }

  function executeCurrentPreview() {
    if (!preview || !connection) {
      return;
    }
    executeMutation.mutate({
      operation: preview,
      connection,
      logContext: buildConnectionLogContextFromProfile(connection, getSshProfileForConnection(connection)),
    });
  }

  function useSelectedResourceName(fallback: string, acceptedKinds: AdminResource["kind"][]) {
    return selectedResource && acceptedKinds.includes(selectedResource.kind) ? selectedResource.name : fallback;
  }

  const effectiveIndexName = useSelectedResourceName(indexName, ["index"]);
  const effectiveTemplateName = useSelectedResourceName(indexTemplateName, ["index-template"]);
  const effectiveComponentName = useSelectedResourceName(componentTemplateName, ["component-template"]);
  const effectivePipelineName = useSelectedResourceName(pipelineName, ["pipeline"]);

  if (!connection) {
    return null;
  }

  return (
    <div className={className}>
      <div className="shrink-0 border-b border-slate-200 bg-white pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="section-title">治理工作台</h1>
              {connection.readonly ? (
                <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                  只读连接
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {connection.name} · {connection.baseUrl} · 当前环境 {connection.environment}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 px-2 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            title={closeTitle}
            aria-label={closeTitle}
            onClick={onClose}
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
              {(Object.keys(SECTION_LABELS) as AdminSection[]).map((section) => (
                <button
                  key={section}
                  type="button"
                  aria-label={SECTION_LABELS[section]}
                  className={cn(
                    "rounded-md border p-3 text-left transition",
                    activeSection === section
                      ? "border-primary bg-secondary text-primary"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-background hover:text-slate-900",
                  )}
                  onClick={() => { setActiveSection(section); setSelectedResourceId(null); setResourcePage(1); }}
                >
                  <p className="text-sm font-semibold">{SECTION_LABELS[section]}</p>
                  <p className="mt-1 text-xs leading-5 opacity-80">{SECTION_DESCRIPTIONS[section]}</p>
                </button>
              ))}
            </div>
          </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-0.5">
        <div className="grid gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Card className="h-fit overflow-hidden p-0">
            <div className="border-b border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">资源列表</h2>
                  <p className="mt-0.5 text-xs leading-5 text-slate-500">按当前功能区筛选 index、alias、template、pipeline。</p>
                </div>
                <Button
                  size="sm"
                  className="px-2.5 text-xs"
                  onClick={() => { void resourcesQuery.refetch(); }}
                  disabled={resourcesQuery.isFetching}
                >
                  {resourcesQuery.isFetching ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="mr-1 h-3.5 w-3.5" />}
                  刷新
                </Button>
              </div>
              {resourcesQuery.error ? (
                <p className="mt-2 rounded-lg border border-rose-100 bg-rose-50 p-2 text-xs leading-5 text-rose-700">{extractUnknownErrorMessage(resourcesQuery.error, "治理资源刷新失败，请检查连接权限。")}</p>
              ) : null}
              {resourcesQuery.data?.partialFailures.map((failure) => (
                <p key={failure} className="mt-2 rounded-lg border border-amber-100 bg-amber-50 p-2 text-xs leading-5 text-amber-800">{failure}</p>
              ))}
            </div>
            <div className="max-h-[680px] overflow-y-auto p-2">
              {visibleResources.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-200 bg-background p-4 text-center text-xs leading-5 text-slate-500">
                  {resourcesQuery.isPending ? "正在读取当前功能区资源…" : "暂无资源数据。点击刷新重试。"}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {resourcePageData.items.map((resource) => (
                    <button
                      key={resource.id}
                      data-testid="admin-resource-row"
                      type="button"
                      className={cn(
                        "w-full rounded-md border p-2.5 text-left transition",
                        selectedResourceId === resource.id
                          ? "border-primary bg-secondary"
                          : "border-slate-200 bg-white hover:bg-background",
                      )}
                      onClick={() => {
                        setSelectedResourceId(resource.id);
                        if (resource.kind === "index") {
                          setIndexName(resource.name);
                          setMappingLeftIndex(resource.name);
                          setRuntimeIndex(resource.name);
                          setAnalyzeIndex(resource.name);
                        }
                        if (resource.kind === "pipeline") {
                          setPipelineName(resource.name);
                        }
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-xs font-semibold text-slate-950">{resource.name}</p>
                        <ResourceKindBadge kind={resource.kind} />
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{resource.detail}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {resourcePageData.pageCount > 1 ? (
              <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-600">
                <span>第 {resourcePageData.page} / {resourcePageData.pageCount} 页 · 共 {resourcePageData.total} 项</span>
                <div className="flex gap-2">
                  <button type="button" aria-label="上一页资源" disabled={resourcePageData.page <= 1} onClick={() => setResourcePage(resourcePageData.page - 1)}>上一页</button>
                  <button type="button" aria-label="下一页资源" disabled={resourcePageData.page >= resourcePageData.pageCount} onClick={() => setResourcePage(resourcePageData.page + 1)}>下一页</button>
                </div>
              </div>
            ) : null}
            {selectedResource ? (
              <div className="border-t border-slate-100 p-3 text-xs">
                <p className="font-bold text-slate-900">{selectedResource.name} 详情</p>
                {detailQuery.error ? <p className="mt-2 text-rose-700">{extractUnknownErrorMessage(detailQuery.error, "资源详情读取失败，请检查连接权限。")}</p> :
                  detailQuery.isPending ? <p className="mt-2 text-slate-500">正在读取详情…</p> :
                    <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-2 text-slate-700">{detailQuery.data}</pre>}
              </div>
            ) : null}
          </Card>

          <div className="space-y-3">
            {activeSection === "indices" ? (
              <div className="grid gap-3" data-testid="admin-indices-panel">
                <div className="grid gap-3 xl:grid-cols-2">
                  <OperationCard
                    icon={<Boxes className="h-4 w-4" />}
                    title="索引基础操作"
                    description="创建索引、查看/修改 settings、查看 mapping、打开/关闭/删除索引。"
                  >
                    <Field label="索引名称">
                      <Input value={indexName} onChange={(event) => setIndexName(event.target.value)} />
                    </Field>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Field label="创建 Settings JSON">
                        <Textarea className="min-h-[150px] font-mono text-xs" value={createSettingsJson} onChange={(event) => setCreateSettingsJson(event.target.value)} />
                      </Field>
                      <Field label="创建 Mappings JSON">
                        <Textarea className="min-h-[150px] font-mono text-xs" value={createMappingsJson} onChange={(event) => setCreateMappingsJson(event.target.value)} />
                      </Field>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildCreateIndexOperation({
                        indexName,
                        settingsJson: createSettingsJson,
                        mappingsJson: createMappingsJson,
                      }))}>
                        生成创建索引请求
                      </Button>
                      <Button variant="outline" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildGetIndexSettingsOperation(effectiveIndexName))}>
                        查看 Settings
                      </Button>
                      <Button variant="outline" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildGetIndexMappingOperation(effectiveIndexName))}>
                        查看 Mapping
                      </Button>
                      <Button variant="outline" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildIndexStateOperation(effectiveIndexName, "open"))}>
                        打开
                      </Button>
                      <Button variant="outline" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildIndexStateOperation(effectiveIndexName, "close"))}>
                        关闭
                      </Button>
                      <Button variant="destructive" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildIndexStateOperation(effectiveIndexName, "delete"))}>
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        删除
                      </Button>
                    </div>
                    <Field label="动态 Settings JSON">
                      <Textarea className="min-h-[100px] font-mono text-xs" value={settingsJson} onChange={(event) => setSettingsJson(event.target.value)} />
                    </Field>
                    <Button variant="outline" className="h-8 w-fit rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildUpdateIndexSettingsOperation({
                      indexName: effectiveIndexName,
                      settingsJson,
                    }))}>
                      生成 Settings 修改请求
                    </Button>
                  </OperationCard>

                  <OperationCard
                    icon={<Route className="h-4 w-4" />}
                    title="Alias 原子切换"
                    description="使用 _aliases 在一个请求中完成 add/remove，适合蓝绿切换写入 alias。"
                  >
                    <div className="grid gap-2 md:grid-cols-2">
                      <Field label="Alias 名称">
                        <Input value={aliasName} onChange={(event) => setAliasName(event.target.value)} />
                      </Field>
                      <Field label="Write Index">
                        <Input value={aliasWriteIndex} onChange={(event) => setAliasWriteIndex(event.target.value)} />
                      </Field>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Field label="移除 Index（逗号或换行）">
                        <Textarea className="min-h-[90px] font-mono text-xs" value={aliasRemoveIndices} onChange={(event) => setAliasRemoveIndices(event.target.value)} />
                      </Field>
                      <Field label="新增 Index（逗号或换行）">
                        <Textarea className="min-h-[90px] font-mono text-xs" value={aliasAddIndices} onChange={(event) => setAliasAddIndices(event.target.value)} />
                      </Field>
                    </div>
                    <Button className="h-8 w-fit rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildAliasSwitchOperation({
                      aliasName,
                      removeIndices: parseListInput(aliasRemoveIndices),
                      addIndices: parseListInput(aliasAddIndices),
                      writeIndex: aliasWriteIndex,
                    }))}>
                      生成 Alias 切换请求
                    </Button>
                  </OperationCard>
                </div>

                <div className="grid gap-3 xl:grid-cols-2">
                  <OperationCard
                    icon={<Activity className="h-4 w-4" />}
                    title="生命周期操作"
                    description="Rollover、forcemerge、异步 reindex、task 查询。"
                  >
                    <div className="grid gap-2 md:grid-cols-2">
                      <Field label="Rollover Alias">
                        <Input value={rolloverAlias} onChange={(event) => setRolloverAlias(event.target.value)} />
                      </Field>
                      <Field label="新索引名称">
                        <Input value={rolloverNewIndex} onChange={(event) => setRolloverNewIndex(event.target.value)} />
                      </Field>
                    </div>
                    <Field label="Rollover 条件 JSON">
                      <Textarea className="min-h-[110px] font-mono text-xs" value={rolloverConditionsJson} onChange={(event) => setRolloverConditionsJson(event.target.value)} />
                    </Field>
                    <div className="flex flex-wrap gap-1">
                      <Button className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildRolloverOperation({
                        aliasName: rolloverAlias,
                        newIndexName: rolloverNewIndex,
                        conditionsJson: rolloverConditionsJson,
                        dryRun: true,
                      }))}>
                        生成 Rollover Dry Run
                      </Button>
                      <Button variant="outline" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildRolloverOperation({
                        aliasName: rolloverAlias,
                        newIndexName: rolloverNewIndex,
                        conditionsJson: rolloverConditionsJson,
                      }))}>
                        生成 Rollover 执行
                      </Button>
                      <Button variant="outline" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildForceMergeOperation({
                        indexName: effectiveIndexName,
                        maxNumSegments: 1,
                      }))}>
                        生成 Force Merge
                      </Button>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Field label="Reindex Source">
                        <Input value={reindexSource} onChange={(event) => setReindexSource(event.target.value)} />
                      </Field>
                      <Field label="Reindex Target">
                        <Input value={reindexTarget} onChange={(event) => setReindexTarget(event.target.value)} />
                      </Field>
                    </div>
                    <Field label="Reindex Query JSON（可空）">
                      <Textarea className="min-h-[90px] font-mono text-xs" value={reindexQueryJson} onChange={(event) => setReindexQueryJson(event.target.value)} />
                    </Field>
                    <div className="flex flex-wrap gap-1">
                      <Button variant="outline" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildReindexOperation({
                        sourceIndex: reindexSource,
                        targetIndex: reindexTarget,
                        queryJson: reindexQueryJson,
                        slices: 2,
                        refresh: true,
                      }))}>
                        生成异步 Reindex
                      </Button>
                      <Input className="h-8 max-w-[260px] text-xs" value={taskId} onChange={(event) => setTaskId(event.target.value)} placeholder="task id，例如 node:123" />
                      <Button variant="outline" className="h-8 rounded-lg px-2.5 text-xs" disabled={!taskId.trim()} onClick={() => generate(() => buildTaskLookupOperation(taskId))}>
                        查询 Task
                      </Button>
                    </div>
                  </OperationCard>

                  <OperationCard
                    icon={<ShieldAlert className="h-4 w-4" />}
                    title="Shrink / Split 分步向导"
                    description="显式生成 read_only、shrink/split、解除写阻断步骤，不做隐藏式自动连环操作。"
                  >
                    <div className="grid gap-2 md:grid-cols-3">
                      <Field label="源索引">
                        <Input value={indexName} onChange={(event) => setIndexName(event.target.value)} />
                      </Field>
                      <Field label="目标索引">
                        <Input value={reindexTarget} onChange={(event) => setReindexTarget(event.target.value)} />
                      </Field>
                      <Field label="目标分片数">
                        <Input value={targetShards} onChange={(event) => setTargetShards(event.target.value)} />
                      </Field>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button variant="outline" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildSetIndexWriteBlockOperation(effectiveIndexName, true))}>
                        1. 开启 read_only
                      </Button>
                      <Button variant="outline" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildShrinkSplitOperation({
                        type: "shrink",
                        sourceIndex: effectiveIndexName,
                        targetIndex: reindexTarget,
                        targetShards: Number(targetShards) || 1,
                      }))}>
                        2. 生成 Shrink
                      </Button>
                      <Button variant="outline" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildShrinkSplitOperation({
                        type: "split",
                        sourceIndex: effectiveIndexName,
                        targetIndex: reindexTarget,
                        targetShards: Number(targetShards) || 2,
                      }))}>
                        2. 生成 Split
                      </Button>
                      <Button variant="outline" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildSetIndexWriteBlockOperation(effectiveIndexName, false))}>
                        3. 解除 read_only
                      </Button>
                    </div>
                    <div className="rounded-md border border-amber-100 bg-amber-50 p-2.5 text-xs leading-5 text-amber-800">
                      shrink/split 需要满足 ES 前置条件，例如源索引只读、分片路由满足要求、目标索引不存在。页面只生成明确步骤，执行前请结合集群状态确认。
                    </div>
                  </OperationCard>
                </div>

                <OperationCard
                  icon={<GitCompare className="h-4 w-4" />}
                  title="Mapping 差异"
                  description="拉取两个索引 mapping，按字段展示新增、删除、变更和未变化。"
                >
                  <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
                    <Field label="左侧索引">
                      <Input value={mappingLeftIndex} onChange={(event) => setMappingLeftIndex(event.target.value)} />
                    </Field>
                    <Field label="右侧索引">
                      <Input value={mappingRightIndex} onChange={(event) => setMappingRightIndex(event.target.value)} />
                    </Field>
                    <Button className="h-9 rounded-lg px-2.5 text-xs" onClick={() => void fetchMappingDiff()}>
                      拉取并对比 Mapping
                    </Button>
                  </div>
                  {mappingDiff ? (
                    <div className="rounded-md border border-slate-200 bg-white p-2.5">
                      <div className="flex flex-wrap gap-1 text-xs">
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700">新增 {mappingDiff.summary.added}</span>
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 font-bold text-rose-700">删除 {mappingDiff.summary.removed}</span>
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 font-bold text-amber-700">变更 {mappingDiff.summary.changed}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-600">未变 {mappingDiff.summary.unchanged}</span>
                      </div>
                      <div className="mt-2 max-h-72 overflow-auto">
                        <table className="min-w-[720px] w-full text-left text-xs">
                          <thead className="text-slate-500">
                            <tr>
                              <th className="py-1 pr-3">字段</th>
                              <th className="py-1 pr-3">状态</th>
                              <th className="py-1 pr-3">{mappingDiff.leftName}</th>
                              <th className="py-1 pr-3">{mappingDiff.rightName}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {mappingPageData.items.map((entry) => (
                              <tr key={entry.field} className="border-t border-slate-100">
                                <td className="py-1 pr-3 font-bold text-slate-900">{entry.field}</td>
                                <td className="py-1 pr-3">{entry.kind}</td>
                                <td className="py-1 pr-3 text-slate-600">{entry.leftType ?? "-"}</td>
                                <td className="py-1 pr-3 text-slate-600">{entry.rightType ?? "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {mappingPageData.pageCount > 1 ? (
                        <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                          <span>第 {mappingPageData.page} / {mappingPageData.pageCount} 页</span>
                          <div className="flex gap-2">
                            <button type="button" aria-label="上一页差异" disabled={mappingPageData.page <= 1} onClick={() => setMappingPage(mappingPageData.page - 1)}>上一页</button>
                            <button type="button" aria-label="下一页差异" disabled={mappingPageData.page >= mappingPageData.pageCount} onClick={() => setMappingPage(mappingPageData.page + 1)}>下一页</button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </OperationCard>
              </div>
            ) : null}

            {activeSection === "templates" ? (
              <div className="grid gap-3" data-testid="admin-templates-panel">
                <div className="grid gap-3 xl:grid-cols-2">
                  <OperationCard icon={<Layers3 className="h-4 w-4" />} title="Index Template" description="创建、更新、simulate 或删除 composable index template。">
                    <div className="grid gap-2 md:grid-cols-2">
                      <Field label="Template 名称">
                        <Input value={indexTemplateName} onChange={(event) => setIndexTemplateName(event.target.value)} />
                      </Field>
                      <Field label="Index Patterns（逗号或换行）">
                        <Input value={indexPatterns} onChange={(event) => setIndexPatterns(event.target.value)} />
                      </Field>
                    </div>
                    <Field label="Composed Of（逗号或换行，可空）">
                      <Input value={componentTemplates} onChange={(event) => setComponentTemplates(event.target.value)} />
                    </Field>
                    <Field label="Template JSON">
                      <Textarea className="min-h-[180px] font-mono text-xs" value={templateJson} onChange={(event) => setTemplateJson(event.target.value)} />
                    </Field>
                    <div className="flex flex-wrap gap-1">
                      <Button className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildPutIndexTemplateOperation({
                        name: indexTemplateName,
                        indexPatterns: parseListInput(indexPatterns),
                        priority: 100,
                        templateJson,
                        componentTemplates: parseListInput(componentTemplates),
                      }))}>
                        生成保存 Index Template
                      </Button>
                      <Button variant="outline" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildSimulateIndexTemplateOperation(effectiveTemplateName))}>
                        Simulate
                      </Button>
                      <Button variant="destructive" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildDeleteNamedResourceOperation({
                        kind: "index-template",
                        name: effectiveTemplateName,
                      }))}>
                        删除
                      </Button>
                    </div>
                  </OperationCard>

                  <OperationCard icon={<Braces className="h-4 w-4" />} title="Component Template" description="创建、更新或删除 component template。">
                    <Field label="Component 名称">
                      <Input value={componentTemplateName} onChange={(event) => setComponentTemplateName(event.target.value)} />
                    </Field>
                    <Field label="Template JSON">
                      <Textarea className="min-h-[220px] font-mono text-xs" value={componentTemplateJson} onChange={(event) => setComponentTemplateJson(event.target.value)} />
                    </Field>
                    <div className="flex flex-wrap gap-1">
                      <Button className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildPutComponentTemplateOperation({
                        name: componentTemplateName,
                        templateJson: componentTemplateJson,
                      }))}>
                        生成保存 Component
                      </Button>
                      <Button variant="destructive" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildDeleteNamedResourceOperation({
                        kind: "component-template",
                        name: effectiveComponentName,
                      }))}>
                        删除
                      </Button>
                    </div>
                  </OperationCard>
                </div>

                <OperationCard icon={<Workflow className="h-4 w-4" />} title="Ingest Pipeline" description="创建、更新、删除 pipeline，并支持 simulate。">
                  <div className="grid gap-2 lg:grid-cols-2">
                    <Field label="Pipeline 名称">
                      <Input value={pipelineName} onChange={(event) => setPipelineName(event.target.value)} />
                    </Field>
                    <Field label="Simulate Pipeline 名称（可用所选 pipeline）">
                      <Input value={effectivePipelineName} onChange={(event) => setPipelineName(event.target.value)} />
                    </Field>
                  </div>
                  <div className="grid gap-2 lg:grid-cols-2">
                    <Field label="Pipeline JSON">
                      <Textarea className="min-h-[190px] font-mono text-xs" value={pipelineJson} onChange={(event) => setPipelineJson(event.target.value)} />
                    </Field>
                    <Field label="Simulate Docs JSON">
                      <Textarea className="min-h-[190px] font-mono text-xs" value={simulateDocsJson} onChange={(event) => setSimulateDocsJson(event.target.value)} />
                    </Field>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildPutIngestPipelineOperation({
                      name: pipelineName,
                      pipelineJson,
                    }))}>
                      生成保存 Pipeline
                    </Button>
                    <Button variant="outline" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildSimulatePipelineOperation({
                      pipelineName: effectivePipelineName,
                      docsJson: simulateDocsJson,
                    }))}>
                      生成 Pipeline Simulate
                    </Button>
                    <Button variant="destructive" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildDeleteNamedResourceOperation({
                      kind: "ingest-pipeline",
                      name: effectivePipelineName,
                    }))}>
                      删除 Pipeline
                    </Button>
                  </div>
                </OperationCard>
              </div>
            ) : null}

            {activeSection === "tools" ? (
              <div className="grid gap-3" data-testid="admin-tools-panel">
                <div className="grid gap-3 xl:grid-cols-2">
                  <OperationCard icon={<Code2 className="h-4 w-4" />} title="Analyzer / Tokenizer 测试" description="调用 _analyze 并在执行结果中表格化展示 token。">
                    <div className="grid gap-2 md:grid-cols-3">
                      <Field label="索引（可空）">
                        <Input value={analyzeIndex} onChange={(event) => setAnalyzeIndex(event.target.value)} />
                      </Field>
                      <Field label="Analyzer">
                        <Input value={analyzer} onChange={(event) => setAnalyzer(event.target.value)} />
                      </Field>
                      <Field label="Tokenizer">
                        <Input value={tokenizer} onChange={(event) => setTokenizer(event.target.value)} />
                      </Field>
                    </div>
                    <Field label="测试文本">
                      <Textarea className="min-h-[120px]" value={analyzeText} onChange={(event) => setAnalyzeText(event.target.value)} />
                    </Field>
                    <Button className="h-8 w-fit rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildAnalyzeOperation({
                      indexName: analyzeIndex,
                      analyzer,
                      tokenizer,
                      text: analyzeText,
                    }))}>
                      生成 Analyze 请求
                    </Button>
                  </OperationCard>

                  <OperationCard icon={<Settings2 className="h-4 w-4" />} title="Runtime Fields 设计器" description="用 runtime_mappings 临时查询验证 runtime fields。">
                    <Field label="索引名称">
                      <Input value={runtimeIndex} onChange={(event) => setRuntimeIndex(event.target.value)} />
                    </Field>
                    <Field label="Runtime Fields JSON">
                      <Textarea className="min-h-[160px] font-mono text-xs" value={runtimeFieldsJson} onChange={(event) => setRuntimeFieldsJson(event.target.value)} />
                    </Field>
                    <Field label="Query JSON（可空）">
                      <Textarea className="min-h-[100px] font-mono text-xs" value={runtimeQueryJson} onChange={(event) => setRuntimeQueryJson(event.target.value)} />
                    </Field>
                    <Button className="h-8 w-fit rounded-lg px-2.5 text-xs" onClick={() => generate(() => buildRuntimeFieldsSearchOperation({
                      indexName: runtimeIndex,
                      runtimeFieldsJson,
                      queryJson: runtimeQueryJson,
                      size: 10,
                    }))}>
                      生成 Runtime Fields 查询
                    </Button>
                  </OperationCard>
                </div>
              </div>
            ) : null}

            <RequestPreviewPanel
              preview={preview}
              execution={execution}
              executing={executeMutation.isPending}
              onSendToConsole={sendPreviewToConsole}
              onExecute={executeCurrentPreview}
            />
          </div>
        </div>
        </div>
    </div>
  );
}
