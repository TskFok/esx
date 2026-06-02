import { ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import type { AiConnectionTestResult } from "../../lib/ai-analysis-client";
import {
  AI_PROVIDER_PRESETS,
  applyAiProviderPreset,
  supportsKimiThinkingMode,
  type AiAnalysisSettings,
  type AiProviderPreset,
} from "../../types/ai-settings";

type AiSettingsDialogProps = {
  open: boolean;
  settings: AiAnalysisSettings;
  apiKeyConfigured: boolean;
  onClose: () => void;
  onSave: (payload: { settings: AiAnalysisSettings; apiKey: string | null; clearApiKey: boolean }) => Promise<void>;
  onTestConnection: (payload: { settings: AiAnalysisSettings; apiKey: string }) => Promise<AiConnectionTestResult>;
  onFetchModels: (payload: { settings: AiAnalysisSettings; apiKey: string }) => Promise<string[]>;
  onLoadStoredApiKey: () => Promise<string | null>;
};

export function AiSettingsDialog({
  open,
  settings,
  apiKeyConfigured,
  onClose,
  onSave,
  onTestConnection,
  onFetchModels,
  onLoadStoredApiKey,
}: AiSettingsDialogProps) {
  const [formValues, setFormValues] = useState(settings);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [manualModelInput, setManualModelInput] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setFormValues(settings);
    setApiKeyInput("");
    setClearApiKey(false);
    setAvailableModels([]);
    setManualModelInput(false);
  }, [open, settings]);

  async function resolveApiKeyForAction() {
    if (clearApiKey) {
      throw new Error("已勾选清除 API Key，请先取消勾选或重新输入。");
    }

    if (apiKeyInput.trim()) {
      return apiKeyInput.trim();
    }

    if (apiKeyConfigured) {
      const stored = await onLoadStoredApiKey();
      if (stored?.trim()) {
        return stored.trim();
      }
    }

    if (!formValues.apiKeyRequired) {
      return "";
    }

    throw new Error("请先输入 API Key。");
  }

  function applyModels(models: string[]) {
    setAvailableModels(models);
    if (models.length === 0) {
      setManualModelInput(true);
      return;
    }

    setManualModelInput(false);
    setFormValues((current) => ({
      ...current,
      model: models.includes(current.model) ? current.model : models[0]!,
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        settings: formValues,
        apiKey: apiKeyInput.trim() ? apiKeyInput.trim() : null,
        clearApiKey,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    if (testing) {
      return;
    }

    setTesting(true);
    try {
      const apiKey = await resolveApiKeyForAction();
      const result = await onTestConnection({
        settings: formValues,
        apiKey,
      });
      applyModels(result.models);
      toast.success(
        result.models.length > 0
          ? `AI 连接测试成功，已加载 ${result.models.length} 个模型。`
          : "AI 连接测试成功。",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI 连接测试失败");
    } finally {
      setTesting(false);
    }
  }

  async function handleFetchModels() {
    if (fetchingModels) {
      return;
    }

    setFetchingModels(true);
    try {
      const apiKey = await resolveApiKeyForAction();
      const models = await onFetchModels({
        settings: formValues,
        apiKey,
      });
      applyModels(models);
      toast.success(models.length > 0 ? `已加载 ${models.length} 个模型。` : "未获取到模型列表。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载模型列表失败");
    } finally {
      setFetchingModels(false);
    }
  }

  function handleSelectPreset(preset: AiProviderPreset) {
    setFormValues((current) => applyAiProviderPreset(current, preset));
    setAvailableModels([]);
    setManualModelInput(false);
  }

  const canSave =
    formValues.baseUrl.trim().length > 0 &&
    formValues.model.trim().length > 0 &&
    (!formValues.enabled ||
      clearApiKey ||
      apiKeyInput.trim().length > 0 ||
      apiKeyConfigured ||
      !formValues.apiKeyRequired);

  const canConnect =
    formValues.baseUrl.trim().length > 0 &&
    (apiKeyInput.trim().length > 0 || apiKeyConfigured || !formValues.apiKeyRequired);

  const canTest = canConnect && formValues.model.trim().length > 0;
  const showModelSelect = availableModels.length > 0 && !manualModelInput;
  const showThinkingModeSwitch = supportsKimiThinkingMode(formValues.model);
  const modelFieldClassName =
    "flex h-12 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <Dialog
      open={open}
      title="AI 分析设置"
      description="配置 OpenAI 兼容接口。API Key 会通过系统钥匙串加密保存，不会写入本地配置文件。"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" className="shrink-0" onClick={onClose} disabled={saving || fetchingModels}>
            取消
          </Button>
          <Button
            variant="outline"
            className="min-w-[6.75rem] shrink-0"
            onClick={() => void handleTestConnection()}
            disabled={!canTest || saving || fetchingModels}
            aria-busy={testing}
          >
            {testing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                测试中...
              </>
            ) : (
              "测试连接"
            )}
          </Button>
          <Button onClick={() => void handleSave()} disabled={!canSave || saving || testing || fetchingModels}>
            {saving ? "保存中..." : "保存设置"}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <div>
          <p className="mb-2 text-sm font-semibold text-slate-700">Provider 预设</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {AI_PROVIDER_PRESETS.map((preset) => {
              const active = formValues.providerId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    active
                      ? "border-emerald-300 bg-emerald-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                  onClick={() => handleSelectPreset(preset)}
                >
                  <p className="text-sm font-semibold text-slate-900">{preset.label}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{preset.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">启用 AI 分析</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">开启后，Console 会优先调用 AI 分析请求格式。</p>
          </div>
          <Switch
            checked={formValues.enabled}
            onChange={(event) => setFormValues((current) => ({ ...current, enabled: event.target.checked }))}
          />
        </div>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">AI 服务地址</span>
          <Input
            placeholder="https://api.openai.com/v1"
            value={formValues.baseUrl}
            onChange={(event) => {
              setAvailableModels([]);
              setFormValues((current) => ({
                ...current,
                baseUrl: event.target.value,
                providerId: "custom",
              }));
            }}
          />
          <p className="mt-2 text-xs leading-5 text-slate-500">支持 OpenAI 兼容接口，会自动追加 /chat/completions。</p>
        </label>

        <div className="block">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-slate-700">模型</span>
            <div className="flex items-center gap-2">
              {showModelSelect ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setManualModelInput(true)}
                >
                  手动输入
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                className="h-7 min-w-[5.5rem] shrink-0 px-2 text-xs"
                disabled={!canConnect || testing}
                aria-busy={fetchingModels}
                onClick={() => void handleFetchModels()}
              >
                {fetchingModels ? "加载中..." : "刷新模型"}
              </Button>
            </div>
          </div>

          {showModelSelect ? (
            <div className="relative">
              <select
                className={cn(modelFieldClassName, "appearance-none pr-10")}
                value={formValues.model}
                onChange={(event) =>
                  setFormValues((current) => ({
                    ...current,
                    model: event.target.value,
                    providerId: "custom",
                  }))
                }
              >
                {availableModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          ) : (
            <Input
              placeholder="gpt-4o-mini"
              value={formValues.model}
              onChange={(event) =>
                setFormValues((current) => ({
                  ...current,
                  model: event.target.value,
                  providerId: "custom",
                }))
              }
            />
          )}
          <p className="mt-2 min-h-5 text-xs leading-5 text-slate-500">
            {availableModels.length > 0 ? `已从 /v1/models 加载 ${availableModels.length} 个模型。` : "\u00a0"}
          </p>
        </div>

        {showThinkingModeSwitch ? (
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">思考模式</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                适用于 kimi-k2.5 / kimi-k2.6。开启后模型会先推理再回答；关闭时更适合结构化 JSON 输出。
              </p>
            </div>
            <Switch
              checked={formValues.thinkingModeEnabled}
              onChange={(event) =>
                setFormValues((current) => ({ ...current, thinkingModeEnabled: event.target.checked }))
              }
            />
          </div>
        ) : null}

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">
            API Key{formValues.apiKeyRequired ? "" : "（可选）"}
          </span>
          <Input
            type="password"
            placeholder={
              formValues.apiKeyRequired
                ? apiKeyConfigured && !clearApiKey
                  ? "已保存，输入新值可覆盖"
                  : AI_PROVIDER_PRESETS.find((item) => item.id === formValues.providerId)?.apiKeyPlaceholder ?? "sk-..."
                : "本地 Ollama 通常无需填写"
            }
            value={apiKeyInput}
            onChange={(event) => setApiKeyInput(event.target.value)}
          />
          {apiKeyConfigured ? (
            <label className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={clearApiKey}
                onChange={(event) => setClearApiKey(event.target.checked)}
              />
              清除已保存的 API Key
            </label>
          ) : null}
        </label>
      </div>
    </Dialog>
  );
}
