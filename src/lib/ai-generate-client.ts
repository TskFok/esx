import {
  extractAiCompletionText,
  isAiAnalysisConfigured,
  postAiChatCompletion,
  resolveAiApiKeyForRequest,
} from "./ai-analysis-client";
import { readOpenAiSseStream, type AiStreamDelta } from "./ai-sse";
import { formatConsoleRequest } from "./console-parser";
import type { AiAnalysisSettings } from "../types/ai-settings";

export type AiGenerateRequest = {
  settings: AiAnalysisSettings;
  apiKey: string;
  description: string;
  context?: AiGenerateContext;
};

export type AiGenerateContext = {
  indexNames?: string[];
  aliasNames?: string[];
};

const SYSTEM_PROMPT = `你是 Elasticsearch Dev Tools 请求生成助手。
用户会用自然语言描述他们想要执行的 Elasticsearch 操作，你需要生成可直接粘贴到 Console 的请求文本。

格式要求：
1. 第一行必须是 METHOD /path 格式，支持 GET、POST、PUT、DELETE、PATCH、HEAD、OPTIONS
2. 如需请求体，从第二行开始必须是合法 JSON
3. 不要连接 Elasticsearch，不要假设真实集群中有哪些文档或字段数据
4. 只返回请求文本本身，不要 markdown 代码块、不要额外解释

示例：
POST /my-index/_search
{
  "query": {
    "match_all": {}
  }
}`;

export function stripMarkdownCodeFence(text: string) {
  const trimmed = text.trim();
  const fencedMatch = trimmed.match(/^```(?:[\w-]+)?\s*([\s\S]*?)```$/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  return trimmed;
}

export function normalizeGeneratedRequestContent(text: string) {
  const stripped = stripMarkdownCodeFence(text);
  if (!stripped) {
    throw new Error("AI 未返回请求内容。");
  }

  try {
    return formatConsoleRequest(stripped);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "AI 返回内容不是合法请求格式。");
  }
}

export function buildGenerateUserPrompt(description: string, context?: AiGenerateContext) {
  const normalizedDescription = description.trim();
  if (!normalizedDescription) {
    throw new Error("请输入请求描述。");
  }

  const hints: string[] = [];
  if (context?.indexNames?.length) {
    hints.push(`已知索引：${context.indexNames.slice(0, 30).join(", ")}`);
  }
  if (context?.aliasNames?.length) {
    hints.push(`已知 alias：${context.aliasNames.slice(0, 30).join(", ")}`);
  }

  if (hints.length === 0) {
    return `请根据以下描述生成 Elasticsearch Console 请求：

${normalizedDescription}`;
  }

  return `请根据以下描述生成 Elasticsearch Console 请求：

${normalizedDescription}

可参考以下本地元数据（如与用户描述相关则优先使用，但不要编造未列出的字段）：
${hints.join("\n")}`;
}

function parseGeneratedCompletionText(completionText: string) {
  return normalizeGeneratedRequestContent(completionText);
}

export async function generateRequestContentWithAi(request: AiGenerateRequest) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildGenerateUserPrompt(request.description, request.context) },
  ];

  const response = await postAiChatCompletion(request.settings, request.apiKey, messages, false, false);
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(extractApiErrorMessage(bodyText, response.status));
  }

  return parseGeneratedCompletionText(extractAiCompletionText(bodyText));
}

export async function generateRequestContentWithAiStream(
  request: AiGenerateRequest,
  onDelta: (delta: AiStreamDelta) => void,
) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildGenerateUserPrompt(request.description, request.context) },
  ];

  const response = await postAiChatCompletion(request.settings, request.apiKey, messages, true, false);
  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(extractApiErrorMessage(bodyText, response.status));
  }

  if (!response.body) {
    const bodyText = await response.text();
    return parseGeneratedCompletionText(extractAiCompletionText(bodyText) || bodyText);
  }

  const accumulated = await readOpenAiSseStream(response.body, onDelta);
  return parseGeneratedCompletionText(accumulated);
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

export { isAiAnalysisConfigured as isAiGenerateConfigured, resolveAiApiKeyForRequest } from "./ai-analysis-client";

export type GenerateRequestOptions = {
  description: string;
  aiSettings: AiAnalysisSettings;
  apiKey: string | null | undefined;
  context?: AiGenerateContext;
  onStreamDelta?: (delta: AiStreamDelta) => void;
};

export async function generateRequestContent(options: GenerateRequestOptions) {
  const { description, aiSettings, apiKey, context, onStreamDelta } = options;

  if (!isAiAnalysisConfigured(aiSettings, apiKey)) {
    throw new Error("AI 未配置，请先在 AI 设置中填写服务地址与模型。");
  }

  const resolvedApiKey = resolveAiApiKeyForRequest(aiSettings, apiKey);
  const request: AiGenerateRequest = {
    settings: aiSettings,
    apiKey: resolvedApiKey,
    description,
    context,
  };

  if (onStreamDelta) {
    return generateRequestContentWithAiStream(request, onStreamDelta);
  }

  return generateRequestContentWithAi(request);
}
