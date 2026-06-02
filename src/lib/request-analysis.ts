import {
  analyzeRequestContentWithAi,
  analyzeRequestContentWithAiStream,
  isAiAnalysisConfigured,
  resolveAiApiKeyForRequest,
} from "./ai-analysis-client";
import type { AiStreamDelta } from "./ai-sse";
import { analyzeRequestContentLocally, type RequestAnalysisResult } from "./request-analyzer";
import type { AiAnalysisSettings } from "../types/ai-settings";

export type AnalyzeRequestOptions = {
  content: string;
  aiSettings: AiAnalysisSettings;
  apiKey: string | null | undefined;
  preferAi?: boolean;
  onStreamDelta?: (delta: AiStreamDelta) => void;
};

export async function analyzeRequestContent(options: AnalyzeRequestOptions): Promise<RequestAnalysisResult> {
  const { content, aiSettings, apiKey, preferAi = true, onStreamDelta } = options;

  if (preferAi && isAiAnalysisConfigured(aiSettings, apiKey)) {
    try {
      const resolvedApiKey = resolveAiApiKeyForRequest(aiSettings, apiKey);
      const request = {
        settings: aiSettings,
        apiKey: resolvedApiKey,
        content,
      };

      if (onStreamDelta) {
        return await analyzeRequestContentWithAiStream(request, onStreamDelta);
      }

      return await analyzeRequestContentWithAi(request);
    } catch {
      return analyzeRequestContentLocally(content);
    }
  }

  return analyzeRequestContentLocally(content);
}

export { analyzeRequestContentLocally } from "./request-analyzer";
export type { RequestAnalysisResult, RequestAnalysisSource } from "./request-analyzer";
