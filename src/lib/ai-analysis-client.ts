import type { AiAnalysisSettings } from "../types/ai-settings";
import { supportsKimiThinkingMode } from "../types/ai-settings";
import { readOpenAiSseStream, type AiStreamDelta } from "./ai-sse";
import { executeAiHttpRequest, type TauriHttpResponse } from "./tauri";
import { ensureTrailingSlashless } from "./utils";
import type { RequestAnalysisResult } from "./request-analyzer";

export type AiAnalysisRequest = {
  settings: AiAnalysisSettings;
  apiKey: string;
  content: string;
};

export type AiConnectionTestRequest = {
  settings: AiAnalysisSettings;
  apiKey: string;
};

const SYSTEM_PROMPT = `你是 Elasticsearch Dev Tools 请求格式分析助手。
你的任务 ONLY 是分析用户提供的请求文本格式是否正确，并解释其含义或给出修正建议。

严格要求：
1. 只分析请求文本本身（第一行 METHOD /path，以及可选 JSON 请求体）。
2. 不要连接 Elasticsearch，不要假设索引里真实存在哪些字段或数据。
3. 不要编造集群状态、文档内容或查询结果。
4. 如果格式正确，用中文解释该请求想做什么。
5. 如果格式错误，用中文列出问题，并给出可能正确的完整请求文本。
6. 必须只返回 JSON，不要输出 markdown 代码块或其它说明文字。

返回 JSON 结构：
{
  "valid": boolean,
  "meaning": string,
  "details": string[],
  "issues": string[],
  "suggestion": string | null
}

字段规则：
- valid=true 时：meaning 必填，details 可为空数组，issues 必须为空数组，suggestion 必须为 null
- valid=false 时：issues 必填且非空，suggestion 尽量给出完整可粘贴的请求文本；meaning 可为空字符串，details 必须为空数组`;

export function resolveChatCompletionsUrl(baseUrl: string) {
  const trimmed = ensureTrailingSlashless(baseUrl.trim());
  if (!trimmed) {
    throw new Error("AI 服务地址不能为空。");
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("AI 服务地址必须以 http:// 或 https:// 开头。");
  }

  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }

  return `${trimmed}/chat/completions`;
}

export function resolveModelsUrl(baseUrl: string) {
  const trimmed = ensureTrailingSlashless(baseUrl.trim());
  if (!trimmed) {
    throw new Error("AI 服务地址不能为空。");
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("AI 服务地址必须以 http:// 或 https:// 开头。");
  }

  const withoutChatCompletions = trimmed.replace(/\/chat\/completions$/, "");
  if (withoutChatCompletions.endsWith("/models")) {
    return withoutChatCompletions;
  }

  return `${withoutChatCompletions}/models`;
}

export function extractJsonObject(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      try {
        return JSON.parse(fencedMatch[1].trim()) as unknown;
      } catch {
        return null;
      }
    }

    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      } catch {
        return null;
      }
    }
  }

  return null;
}

export function normalizeAiAnalysisResult(value: unknown): RequestAnalysisResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const valid = record.valid === true;

  if (valid) {
    const meaning = typeof record.meaning === "string" ? record.meaning.trim() : "";
    if (!meaning) {
      return null;
    }

    const details = Array.isArray(record.details)
      ? record.details.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];

    return {
      valid: true,
      meaning,
      details,
      source: "ai",
    };
  }

  const issues = Array.isArray(record.issues)
    ? record.issues.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  if (issues.length === 0) {
    return null;
  }

  const suggestion =
    typeof record.suggestion === "string" && record.suggestion.trim().length > 0
      ? record.suggestion.trim()
      : null;

  return {
    valid: false,
    issues,
    suggestion,
    source: "ai",
  };
}

function buildUserPrompt(content: string) {
  return `请分析以下 Elasticsearch Console 请求内容：

${content}`;
}

function extractApiErrorMessage(bodyText: string, status: number) {
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const error = parsed.error;
    if (typeof error === "string" && error.trim()) {
      return error.trim();
    }
    if (error && typeof error === "object" && !Array.isArray(error)) {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) {
        return message.trim();
      }
    }
    const message = parsed.message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  } catch {
    // ignore
  }

  const trimmed = bodyText.trim();
  if (trimmed) {
    return trimmed.slice(0, 240);
  }

  return `AI 服务返回 ${status}`;
}

function validateAiRequestSettings(settings: AiAnalysisSettings, apiKey: string) {
  const model = settings.model.trim();
  if (!model) {
    throw new Error("AI 模型不能为空。");
  }

  if (settings.apiKeyRequired && !apiKey.trim()) {
    throw new Error("AI API Key 未配置。");
  }

  return {
    model,
    apiKey: apiKey.trim(),
    url: resolveChatCompletionsUrl(settings.baseUrl),
  };
}

export function resolveChatCompletionOptions(settings: AiAnalysisSettings) {
  const model = settings.model.trim();

  if (!supportsKimiThinkingMode(model)) {
    return {
      temperature: 0.2,
      thinking: undefined,
    };
  }

  if (settings.thinkingModeEnabled) {
    return {
      temperature: 1.0,
      thinking: { type: "enabled" as const },
    };
  }

  return {
    temperature: 0.6,
    thinking: { type: "disabled" as const },
  };
}

export function buildChatCompletionBody(
  settings: AiAnalysisSettings,
  messages: Array<{ role: string; content: string }>,
  stream: boolean,
  jsonResponse = !stream,
) {
  const { temperature, thinking } = resolveChatCompletionOptions(settings);

  return JSON.stringify({
    model: settings.model.trim(),
    temperature,
    ...(thinking ? { thinking } : {}),
    stream,
    ...(jsonResponse && !stream ? { response_format: { type: "json_object" } } : {}),
    messages,
  });
}

export function extractAiCompletionText(bodyText: string) {
  try {
    const payload = JSON.parse(bodyText) as Record<string, unknown>;
    const choices = payload.choices;
    if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
      const message = (choices[0] as Record<string, unknown>).message;
      if (message && typeof message === "object" && !Array.isArray(message)) {
        const content = (message as Record<string, unknown>).content;
        if (typeof content === "string") {
          return content;
        }
      }
    }
  } catch {
    throw new Error("AI 服务响应格式无效。");
  }

  return "";
}

function parseAiCompletionText(completionText: string) {
  if (!completionText.trim()) {
    throw new Error("AI 服务未返回分析结果。");
  }

  const parsed = extractJsonObject(completionText);
  const normalized = normalizeAiAnalysisResult(parsed);
  if (!normalized) {
    throw new Error("AI 返回内容无法解析为分析结果。");
  }

  return normalized;
}

export type AiConnectionTestResult = {
  models: string[];
};

function responseFromTauriHttp(result: TauriHttpResponse, contentType: string) {
  const status = result.status >= 200 && result.status <= 599 ? result.status : 599;
  return new Response(result.bodyText, {
    status,
    statusText: result.statusText || "REQUEST_FAILED",
    headers: {
      "Content-Type": contentType,
    },
  });
}

function parseModelsPayload(bodyText: string) {
  try {
    const payload = JSON.parse(bodyText) as Record<string, unknown>;
    const data = payload.data;
    if (!Array.isArray(data)) {
      return [];
    }

    const models = data
      .map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return null;
        }
        const id = (item as Record<string, unknown>).id;
        return typeof id === "string" && id.trim() ? id.trim() : null;
      })
      .filter((item): item is string => Boolean(item));

    return [...new Set(models)].sort((left, right) => left.localeCompare(right, "zh-CN"));
  } catch {
    return [];
  }
}

export async function fetchAiModels(request: AiConnectionTestRequest) {
  const baseUrl = request.settings.baseUrl.trim();
  if (!baseUrl) {
    throw new Error("AI 服务地址不能为空。");
  }

  if (request.settings.apiKeyRequired && !request.apiKey.trim()) {
    throw new Error("AI API Key 未配置。");
  }

  const url = resolveModelsUrl(request.settings.baseUrl);
  const response = await executeAiHttpRequest({
    url,
    method: "GET",
    apiKey: request.apiKey,
    accept: "application/json",
  });

  const bodyText = response.bodyText;
  if (!response.ok) {
    throw new Error(extractApiErrorMessage(bodyText, response.status));
  }

  return parseModelsPayload(bodyText);
}

export async function postAiChatCompletion(
  settings: AiAnalysisSettings,
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  stream: boolean,
  jsonResponse = !stream,
) {
  const { url } = validateAiRequestSettings(settings, apiKey);
  const accept = stream ? "text/event-stream" : "application/json";
  const response = await executeAiHttpRequest({
    url,
    method: "POST",
    apiKey,
    accept,
    contentType: "application/json",
    bodyText: buildChatCompletionBody(settings, messages, stream, jsonResponse),
  });
  return responseFromTauriHttp(response, accept);
}

export async function testAiConnection(request: AiConnectionTestRequest): Promise<AiConnectionTestResult> {
  const response = await postAiChatCompletion(
    request.settings,
    request.apiKey,
    [
      { role: "system", content: "You are a connectivity probe. Reply with exactly OK." },
      { role: "user", content: "ping" },
    ],
    false,
  );

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(extractApiErrorMessage(bodyText, response.status));
  }

  const completionText = extractAiCompletionText(bodyText);
  if (!completionText.trim()) {
    throw new Error("AI 服务未返回有效响应。");
  }

  try {
    const models = await fetchAiModels(request);
    return { models };
  } catch {
    return { models: [] };
  }
}

export async function analyzeRequestContentWithAi(request: AiAnalysisRequest): Promise<RequestAnalysisResult> {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(request.content) },
  ];

  const response = await postAiChatCompletion(request.settings, request.apiKey, messages, false);
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(extractApiErrorMessage(bodyText, response.status));
  }

  return parseAiCompletionText(extractAiCompletionText(bodyText));
}

export async function analyzeRequestContentWithAiStream(
  request: AiAnalysisRequest,
  onDelta: (delta: AiStreamDelta) => void,
): Promise<RequestAnalysisResult> {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(request.content) },
  ];

  const response = await postAiChatCompletion(request.settings, request.apiKey, messages, true);
  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(extractApiErrorMessage(bodyText, response.status));
  }

  if (!response.body) {
    const bodyText = await response.text();
    return parseAiCompletionText(extractAiCompletionText(bodyText) || bodyText);
  }

  const accumulated = await readOpenAiSseStream(response.body, onDelta);
  return parseAiCompletionText(accumulated);
}

export function isAiAnalysisConfigured(settings: AiAnalysisSettings, apiKey: string | null | undefined) {
  if (!settings.enabled || settings.baseUrl.trim().length === 0 || settings.model.trim().length === 0) {
    return false;
  }

  if (!settings.apiKeyRequired) {
    return true;
  }

  return Boolean(apiKey?.trim());
}

export function resolveAiApiKeyForRequest(settings: AiAnalysisSettings, apiKey: string | null | undefined) {
  if (!settings.apiKeyRequired) {
    return apiKey?.trim() ?? "";
  }

  const resolved = apiKey?.trim();
  if (!resolved) {
    throw new Error("AI API Key 未配置。");
  }

  return resolved;
}
