export type AdminHttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type AdminOperationGroup = "indices" | "templates" | "tools";

export type AdminOperation = {
  id: string;
  group: AdminOperationGroup;
  title: string;
  description: string;
  method: AdminHttpMethod;
  path: string;
  bodyText: string;
};

export type AdminRequestPreview = AdminOperation & {
  content: string;
};

export type AdminExecutionResult = {
  operation: AdminOperation;
  ok: boolean;
  status: number;
  statusText: string;
  durationMs: number;
  executedAt: string;
  bodyText: string;
  diagnostics: string[];
};

export type MappingDiffKind = "added" | "removed" | "changed" | "unchanged";

export type MappingDiffEntry = {
  field: string;
  kind: MappingDiffKind;
  leftType: string | null;
  rightType: string | null;
  leftDefinition?: unknown;
  rightDefinition?: unknown;
};

export type MappingDiffResult = {
  leftName: string;
  rightName: string;
  summary: Record<MappingDiffKind, number>;
  entries: MappingDiffEntry[];
};

export type AnalyzeToken = {
  token: string;
  startOffset: number;
  endOffset: number;
  type: string;
  position: number;
};
