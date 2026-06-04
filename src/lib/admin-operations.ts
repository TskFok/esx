import { buildConsoleContent } from "./console-parser";
import type {
  AdminOperation,
  AdminOperationGroup,
  AdminRequestPreview,
  AnalyzeToken,
  MappingDiffEntry,
  MappingDiffResult,
} from "../types/admin";

type JsonRecord = Record<string, unknown>;

type IndexStateAction = "open" | "close" | "delete";

type ShrinkSplitType = "shrink" | "split";

const EMPTY_OBJECT = {};

function encodePathSegment(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("名称不能为空。");
  }
  return encodeURIComponent(trimmed);
}

function appendQuery(path: string, params: Record<string, string | number | boolean | null | undefined>) {
  const query = Object.entries(params)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined && entry[1] !== null && entry[1] !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return query ? `${path}?${query}` : path;
}

function parseJsonRecord(jsonText: string, label: string, fallback: JsonRecord | null = null): JsonRecord {
  const trimmed = jsonText.trim();
  if (!trimmed) {
    if (fallback) {
      return fallback;
    }
    throw new Error(`${label} 不能为空。`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(`${label} 必须是合法 JSON。`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象。`);
  }

  return parsed as JsonRecord;
}

function optionalJsonRecord(jsonText: string, label: string): JsonRecord | null {
  return jsonText.trim() ? parseJsonRecord(jsonText, label) : null;
}

function stringifyBody(body: unknown) {
  return body && typeof body === "object" ? JSON.stringify(body, null, 2) : "";
}

function createOperation(input: {
  id: string;
  group: AdminOperationGroup;
  title: string;
  description: string;
  method: AdminOperation["method"];
  path: string;
  body?: unknown;
  bodyText?: string;
}): AdminOperation {
  return {
    id: input.id,
    group: input.group,
    title: input.title,
    description: input.description,
    method: input.method,
    path: input.path,
    bodyText: input.bodyText ?? stringifyBody(input.body),
  };
}

export function buildAdminRequestPreview(operation: AdminOperation): AdminRequestPreview {
  return {
    ...operation,
    content: buildConsoleContent(operation.method, operation.path, operation.bodyText),
  };
}

export function buildCreateIndexOperation(input: {
  indexName: string;
  settingsJson?: string;
  mappingsJson?: string;
  aliasesJson?: string;
}): AdminOperation {
  const body: JsonRecord = {};
  const settings = optionalJsonRecord(input.settingsJson ?? "", "Settings");
  const mappings = optionalJsonRecord(input.mappingsJson ?? "", "Mappings");
  const aliases = optionalJsonRecord(input.aliasesJson ?? "", "Aliases");
  if (settings) {
    body.settings = settings;
  }
  if (mappings) {
    body.mappings = mappings;
  }
  if (aliases) {
    body.aliases = aliases;
  }

  return createOperation({
    id: "index-create",
    group: "indices",
    title: "创建索引",
    description: "创建新索引，可附带 settings、mappings 和 aliases。",
    method: "PUT",
    path: `/${encodePathSegment(input.indexName)}`,
    body,
  });
}

export function buildIndexStateOperation(indexName: string, action: IndexStateAction): AdminOperation {
  const encodedName = encodePathSegment(indexName);
  const actionLabels: Record<IndexStateAction, string> = {
    open: "打开索引",
    close: "关闭索引",
    delete: "删除索引",
  };

  if (action === "delete") {
    return createOperation({
      id: "index-delete",
      group: "indices",
      title: actionLabels[action],
      description: "删除指定索引。该操作不可逆。",
      method: "DELETE",
      path: `/${encodedName}`,
    });
  }

  return createOperation({
    id: `index-${action}`,
    group: "indices",
    title: actionLabels[action],
    description: `${actionLabels[action]}，会影响索引读写可用性。`,
    method: "POST",
    path: `/${encodedName}/_${action}`,
  });
}

export function buildGetIndexSettingsOperation(indexName: string): AdminOperation {
  return createOperation({
    id: "index-settings-get",
    group: "indices",
    title: "查看 Settings",
    description: "读取指定索引 settings。",
    method: "GET",
    path: `/${encodePathSegment(indexName)}/_settings?include_defaults=true`,
  });
}

export function buildUpdateIndexSettingsOperation(input: {
  indexName: string;
  settingsJson: string;
}): AdminOperation {
  return createOperation({
    id: "index-settings-update",
    group: "indices",
    title: "修改 Settings",
    description: "修改索引动态 settings。静态 settings 仍需按 Elasticsearch 规则关闭索引后处理。",
    method: "PUT",
    path: `/${encodePathSegment(input.indexName)}/_settings`,
    body: parseJsonRecord(input.settingsJson, "Settings"),
  });
}

export function buildGetIndexMappingOperation(indexName: string): AdminOperation {
  return createOperation({
    id: "index-mapping-get",
    group: "indices",
    title: "查看 Mapping",
    description: "读取指定索引 mapping。",
    method: "GET",
    path: `/${encodePathSegment(indexName)}/_mapping?include_type_name=false`,
  });
}

export function buildAliasSwitchOperation(input: {
  aliasName: string;
  removeIndices: string[];
  addIndices: string[];
  writeIndex?: string | null;
}): AdminOperation {
  const alias = input.aliasName.trim();
  if (!alias) {
    throw new Error("Alias 名称不能为空。");
  }

  const actions = [
    ...input.removeIndices.map((index) => index.trim()).filter(Boolean).map((index) => ({
      remove: { index, alias },
    })),
    ...input.addIndices.map((index) => index.trim()).filter(Boolean).map((index) => ({
      add: {
        index,
        alias,
        ...(input.writeIndex?.trim() === index ? { is_write_index: true } : {}),
      },
    })),
  ];

  if (actions.length === 0) {
    throw new Error("Alias 切换至少需要一个 add 或 remove 动作。");
  }

  return createOperation({
    id: "alias-switch",
    group: "indices",
    title: "Alias 原子切换",
    description: "使用 _aliases API 在一个原子请求中增删 alias 绑定。",
    method: "POST",
    path: "/_aliases",
    body: { actions },
  });
}

export function buildRolloverOperation(input: {
  aliasName: string;
  newIndexName?: string;
  conditionsJson?: string;
  dryRun?: boolean;
}): AdminOperation {
  const conditions = optionalJsonRecord(input.conditionsJson ?? "", "Rollover 条件") ?? EMPTY_OBJECT;
  const newIndex = input.newIndexName?.trim() ? `/${encodePathSegment(input.newIndexName)}` : "";

  return createOperation({
    id: "rollover",
    group: "indices",
    title: "Rollover",
    description: "基于 write alias 执行 rollover；可先 dry run。",
    method: "POST",
    path: appendQuery(`/${encodePathSegment(input.aliasName)}/_rollover${newIndex}`, {
      dry_run: input.dryRun ? true : undefined,
    }),
    body: conditions,
  });
}

export function buildForceMergeOperation(input: {
  indexName: string;
  maxNumSegments?: number | null;
  onlyExpungeDeletes?: boolean;
  flush?: boolean;
}): AdminOperation {
  return createOperation({
    id: "forcemerge",
    group: "indices",
    title: "Force Merge",
    description: "触发索引 forcemerge。建议仅在只读索引和低峰期执行。",
    method: "POST",
    path: appendQuery(`/${encodePathSegment(input.indexName)}/_forcemerge`, {
      max_num_segments: input.maxNumSegments ?? undefined,
      only_expunge_deletes: input.onlyExpungeDeletes ? true : undefined,
      flush: input.flush === false ? false : undefined,
    }),
  });
}

export function buildReindexOperation(input: {
  sourceIndex: string;
  targetIndex: string;
  queryJson?: string;
  slices?: number | null;
  refresh?: boolean;
}): AdminOperation {
  const query = optionalJsonRecord(input.queryJson ?? "", "Reindex query");
  const body: JsonRecord = {
    source: {
      index: input.sourceIndex.trim(),
      ...(query ? { query } : {}),
    },
    dest: {
      index: input.targetIndex.trim(),
    },
  };
  if (input.refresh) {
    body.refresh = true;
  }
  if (input.slices && input.slices > 1) {
    body.slices = input.slices;
  }

  return createOperation({
    id: "reindex",
    group: "indices",
    title: "Reindex",
    description: "异步提交 reindex，默认 wait_for_completion=false，并可用返回的 task id 查询进度。",
    method: "POST",
    path: "/_reindex?wait_for_completion=false",
    body,
  });
}

export function buildTaskLookupOperation(taskId: string): AdminOperation {
  return createOperation({
    id: "task-lookup",
    group: "indices",
    title: "查询 Task",
    description: "查询 reindex、forcemerge 等后台任务状态。",
    method: "GET",
    path: `/_tasks/${encodePathSegment(taskId)}`,
  });
}

export function buildSetIndexWriteBlockOperation(indexName: string, enabled: boolean): AdminOperation {
  return createOperation({
    id: enabled ? "index-write-block-enable" : "index-write-block-disable",
    group: "indices",
    title: enabled ? "开启写入阻断" : "关闭写入阻断",
    description: "shrink/split 前后常用的显式分步操作。",
    method: "PUT",
    path: `/${encodePathSegment(indexName)}/_settings`,
    body: {
      "index.blocks.write": enabled,
    },
  });
}

export function buildShrinkSplitOperation(input: {
  type: ShrinkSplitType;
  sourceIndex: string;
  targetIndex: string;
  targetShards: number;
  settingsJson?: string;
  aliasesJson?: string;
}): AdminOperation {
  const settings = {
    ...(optionalJsonRecord(input.settingsJson ?? "", "目标索引 settings") ?? {}),
    "index.number_of_shards": input.targetShards,
  };
  const aliases = optionalJsonRecord(input.aliasesJson ?? "", "目标索引 aliases");

  return createOperation({
    id: input.type,
    group: "indices",
    title: input.type === "shrink" ? "Shrink 索引" : "Split 索引",
    description: "仅生成结构变更步骤请求；read_only 和 alias 切换需显式分步执行。",
    method: "PUT",
    path: `/${encodePathSegment(input.sourceIndex)}/_${input.type}/${encodePathSegment(input.targetIndex)}`,
    body: {
      settings,
      ...(aliases ? { aliases } : {}),
    },
  });
}

export function buildPutIndexTemplateOperation(input: {
  name: string;
  indexPatterns: string[];
  priority?: number | null;
  templateJson: string;
  componentTemplates?: string[];
}): AdminOperation {
  const body: JsonRecord = {
    index_patterns: input.indexPatterns.map((item) => item.trim()).filter(Boolean),
    template: parseJsonRecord(input.templateJson, "Template"),
  };
  if (input.priority !== undefined && input.priority !== null) {
    body.priority = input.priority;
  }
  const composedOf = input.componentTemplates?.map((item) => item.trim()).filter(Boolean) ?? [];
  if (composedOf.length > 0) {
    body.composed_of = composedOf;
  }

  return createOperation({
    id: "index-template-put",
    group: "templates",
    title: "保存 Index Template",
    description: "创建或更新 composable index template。",
    method: "PUT",
    path: `/_index_template/${encodePathSegment(input.name)}`,
    body,
  });
}

export function buildPutComponentTemplateOperation(input: {
  name: string;
  templateJson: string;
}): AdminOperation {
  return createOperation({
    id: "component-template-put",
    group: "templates",
    title: "保存 Component Template",
    description: "创建或更新 component template。",
    method: "PUT",
    path: `/_component_template/${encodePathSegment(input.name)}`,
    body: { template: parseJsonRecord(input.templateJson, "Template") },
  });
}

export function buildPutIngestPipelineOperation(input: {
  name: string;
  pipelineJson: string;
}): AdminOperation {
  return createOperation({
    id: "ingest-pipeline-put",
    group: "templates",
    title: "保存 Ingest Pipeline",
    description: "创建或更新 ingest pipeline。",
    method: "PUT",
    path: `/_ingest/pipeline/${encodePathSegment(input.name)}`,
    body: parseJsonRecord(input.pipelineJson, "Pipeline"),
  });
}

export function buildDeleteNamedResourceOperation(input: {
  kind: "index-template" | "component-template" | "ingest-pipeline";
  name: string;
}): AdminOperation {
  const pathByKind = {
    "index-template": "_index_template",
    "component-template": "_component_template",
    "ingest-pipeline": "_ingest/pipeline",
  } satisfies Record<typeof input.kind, string>;

  return createOperation({
    id: `${input.kind}-delete`,
    group: "templates",
    title: "删除资源",
    description: "删除指定模板或 pipeline。",
    method: "DELETE",
    path: `/${pathByKind[input.kind]}/${encodePathSegment(input.name)}`,
  });
}

export function buildSimulateIndexTemplateOperation(name: string): AdminOperation {
  return createOperation({
    id: "index-template-simulate",
    group: "templates",
    title: "Simulate Index Template",
    description: "模拟指定 index template 的最终模板结果。",
    method: "POST",
    path: `/_index_template/_simulate/${encodePathSegment(name)}`,
  });
}

export function buildSimulatePipelineOperation(input: {
  pipelineName?: string;
  docsJson: string;
}): AdminOperation {
  const pipelinePath = input.pipelineName?.trim() ? `/${encodePathSegment(input.pipelineName)}` : "";
  return createOperation({
    id: "pipeline-simulate",
    group: "tools",
    title: "Pipeline Simulate",
    description: "使用 ingest simulate 验证 pipeline 处理结果。",
    method: "POST",
    path: `/_ingest/pipeline${pipelinePath}/_simulate`,
    body: parseJsonRecord(input.docsJson, "Simulate docs"),
  });
}

export function buildAnalyzeOperation(input: {
  indexName?: string;
  analyzer?: string;
  tokenizer?: string;
  filters?: string[];
  text: string;
}): AdminOperation {
  const body: JsonRecord = { text: input.text };
  if (input.analyzer?.trim()) {
    body.analyzer = input.analyzer.trim();
  }
  if (input.tokenizer?.trim()) {
    body.tokenizer = input.tokenizer.trim();
  }
  const filters = input.filters?.map((item) => item.trim()).filter(Boolean) ?? [];
  if (filters.length > 0) {
    body.filter = filters;
  }

  return createOperation({
    id: "analyze",
    group: "tools",
    title: "Analyze",
    description: "测试 analyzer/tokenizer/filter 的分词结果。",
    method: "POST",
    path: input.indexName?.trim() ? `/${encodePathSegment(input.indexName)}/_analyze` : "/_analyze",
    body,
  });
}

export function buildRuntimeFieldsSearchOperation(input: {
  indexName: string;
  runtimeFieldsJson: string;
  queryJson?: string;
  fields?: string[];
  size?: number;
}): AdminOperation {
  const runtimeMappings = parseJsonRecord(input.runtimeFieldsJson, "Runtime fields");
  const query = optionalJsonRecord(input.queryJson ?? "", "Query");
  const fields = input.fields?.map((item) => item.trim()).filter(Boolean) ?? [];

  return createOperation({
    id: "runtime-fields-search",
    group: "tools",
    title: "Runtime Fields 查询",
    description: "用 runtime_mappings 临时验证 runtime fields。",
    method: "POST",
    path: `/${encodePathSegment(input.indexName)}/_search`,
    body: {
      runtime_mappings: runtimeMappings,
      query: query ?? { match_all: {} },
      size: input.size ?? 10,
      ...(fields.length > 0 ? { fields } : {}),
    },
  });
}

function stableStringify(value: unknown): string {
  if (!value || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const record = value as JsonRecord;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function getFieldType(definition: unknown) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    return "object";
  }
  const record = definition as JsonRecord;
  return typeof record.type === "string" ? record.type : "object";
}

function extractMappingsRoot(mapping: unknown) {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    return null;
  }

  const record = mapping as JsonRecord;
  if (record.properties || record.runtime) {
    return record;
  }

  const firstValue = Object.values(record)[0];
  if (firstValue && typeof firstValue === "object" && !Array.isArray(firstValue)) {
    const mappings = (firstValue as JsonRecord).mappings;
    if (mappings && typeof mappings === "object" && !Array.isArray(mappings)) {
      return mappings as JsonRecord;
    }
  }

  return record.mappings && typeof record.mappings === "object" && !Array.isArray(record.mappings)
    ? record.mappings as JsonRecord
    : null;
}

function flattenMappingDefinitions(mapping: unknown) {
  const root = extractMappingsRoot(mapping);
  const result = new Map<string, unknown>();

  const walkProperties = (node: unknown, prefix: string[]) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return;
    }
    Object.entries(node as JsonRecord).forEach(([field, definition]) => {
      const nextPath = [...prefix, field];
      const name = nextPath.join(".");
      result.set(name, definition);
      if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
        return;
      }
      const record = definition as JsonRecord;
      if (record.properties) {
        walkProperties(record.properties, nextPath);
      }
      if (record.fields) {
        walkProperties(record.fields, nextPath);
      }
    });
  };

  if (root?.properties) {
    walkProperties(root.properties, []);
  }
  if (root?.runtime && typeof root.runtime === "object" && !Array.isArray(root.runtime)) {
    Object.entries(root.runtime as JsonRecord).forEach(([field, definition]) => {
      result.set(field, definition);
    });
  }

  return result;
}

export function buildMappingDiff(input: {
  leftName: string;
  rightName: string;
  leftMapping: unknown;
  rightMapping: unknown;
}): MappingDiffResult {
  const left = flattenMappingDefinitions(input.leftMapping);
  const right = flattenMappingDefinitions(input.rightMapping);
  const fields = [...new Set([...left.keys(), ...right.keys()])].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const entries: MappingDiffEntry[] = fields.map((field) => {
    const leftDefinition = left.get(field);
    const rightDefinition = right.get(field);
    const leftType = leftDefinition ? getFieldType(leftDefinition) : null;
    const rightType = rightDefinition ? getFieldType(rightDefinition) : null;
    const kind: MappingDiffEntry["kind"] =
      leftDefinition === undefined
        ? "added"
        : rightDefinition === undefined
          ? "removed"
          : stableStringify(leftDefinition) === stableStringify(rightDefinition)
            ? "unchanged"
            : "changed";

    return {
      field,
      kind,
      leftType,
      rightType,
      leftDefinition,
      rightDefinition,
    };
  });

  const summary = entries.reduce(
    (acc, entry) => ({
      ...acc,
      [entry.kind]: acc[entry.kind] + 1,
    }),
    { added: 0, removed: 0, changed: 0, unchanged: 0 },
  );

  return {
    leftName: input.leftName,
    rightName: input.rightName,
    summary,
    entries,
  };
}

export function parseAnalyzeTokens(bodyText: string): AnalyzeToken[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray((parsed as JsonRecord).tokens)) {
    return [];
  }

  return ((parsed as JsonRecord).tokens as unknown[]).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as JsonRecord;
    return [{
      token: typeof record.token === "string" ? record.token : "",
      startOffset: typeof record.start_offset === "number" ? record.start_offset : 0,
      endOffset: typeof record.end_offset === "number" ? record.end_offset : 0,
      type: typeof record.type === "string" ? record.type : "",
      position: typeof record.position === "number" ? record.position : 0,
    }];
  });
}
