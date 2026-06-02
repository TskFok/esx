export type AiAnalysisSettings = {
  enabled: boolean;
  baseUrl: string;
  model: string;
  providerId: string | null;
  apiKeyRequired: boolean;
  thinkingModeEnabled: boolean;
};

export const DEFAULT_AI_ANALYSIS_SETTINGS: AiAnalysisSettings = {
  enabled: false,
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  providerId: "openai",
  apiKeyRequired: true,
  thinkingModeEnabled: false,
};

export type AiProviderPreset = {
  id: string;
  label: string;
  description: string;
  baseUrl: string;
  model: string;
  apiKeyRequired: boolean;
  apiKeyPlaceholder: string;
};

export const AI_PROVIDER_PRESETS: ReadonlyArray<AiProviderPreset> = [
  {
    id: "openai",
    label: "OpenAI",
    description: "官方 OpenAI API",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKeyRequired: true,
    apiKeyPlaceholder: "sk-...",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek OpenAI 兼容接口",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    apiKeyRequired: true,
    apiKeyPlaceholder: "sk-...",
  },
  {
    id: "kimi",
    label: "Kimi",
    description: "Kimi 开放平台 OpenAI 兼容接口，使用 platform.kimi.com 申请的 API Key",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k2.6",
    apiKeyRequired: true,
    apiKeyPlaceholder: "在 Kimi 开放平台申请的 API Key",
  },
  {
    id: "ollama",
    label: "Ollama",
    description: "本地 Ollama 服务，通常无需 API Key",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2",
    apiKeyRequired: false,
    apiKeyPlaceholder: "可选，本地一般留空",
  },
  {
    id: "custom",
    label: "自定义",
    description: "手动填写地址与模型",
    baseUrl: "",
    model: "",
    apiKeyRequired: true,
    apiKeyPlaceholder: "sk-...",
  },
];

export function findAiProviderPreset(providerId: string | null | undefined) {
  return AI_PROVIDER_PRESETS.find((item) => item.id === providerId) ?? null;
}

export function supportsKimiThinkingMode(model: string) {
  return /^kimi-k2\.[56]/i.test(model.trim());
}

export function applyAiProviderPreset(
  current: AiAnalysisSettings,
  preset: AiProviderPreset,
): AiAnalysisSettings {
  if (preset.id === "custom") {
    return {
      ...current,
      providerId: preset.id,
      apiKeyRequired: preset.apiKeyRequired,
    };
  }

  return {
    ...current,
    providerId: preset.id,
    baseUrl: preset.baseUrl,
    model: preset.model,
    apiKeyRequired: preset.apiKeyRequired,
  };
}
