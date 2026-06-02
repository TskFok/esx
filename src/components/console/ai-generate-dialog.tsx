import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Textarea } from "../ui/textarea";

type AiGenerateDialogProps = {
  open: boolean;
  isGenerating: boolean;
  streamingReasoningText: string;
  streamingContentText: string;
  generatedContent: string | null;
  generateError: string | null;
  aiEnabled: boolean;
  aiConfigured: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onGenerate: (description: string) => void;
  onApply: () => void;
};

export function AiGenerateDialog({
  open,
  isGenerating,
  streamingReasoningText,
  streamingContentText,
  generatedContent,
  generateError,
  aiEnabled,
  aiConfigured,
  onClose,
  onOpenSettings,
  onGenerate,
  onApply,
}: AiGenerateDialogProps) {
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) {
      setDescription("");
    }
  }, [open]);

  const hasStreamingReasoning = streamingReasoningText.trim().length > 0;
  const hasStreamingContent = streamingContentText.trim().length > 0;
  const showStreaming = isGenerating && (hasStreamingReasoning || hasStreamingContent);
  const canGenerate = description.trim().length > 0 && !isGenerating;

  function handleGenerate() {
    if (!canGenerate) {
      return;
    }

    onGenerate(description.trim());
  }

  return (
    <Dialog
      open={open}
      title="AI 生成请求"
      description="输入自然语言描述，AI 将生成可直接执行的 Elasticsearch Console 请求，不会连接集群。"
      panelClassName="max-w-3xl"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          {!aiEnabled || !aiConfigured ? (
            <Button variant="outline" onClick={onOpenSettings}>
              配置 AI
            </Button>
          ) : null}
          <Button variant="outline" onClick={handleGenerate} disabled={!canGenerate}>
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                生成中...
              </>
            ) : (
              "生成请求"
            )}
          </Button>
          {generatedContent && !isGenerating ? <Button onClick={onApply}>应用到编辑器</Button> : null}
        </>
      }
    >
      <div className="space-y-4">
        {!aiEnabled ? (
          <div className="rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-sm leading-7 text-amber-900">
            AI 功能未启用，请先在 AI 设置中开启。
          </div>
        ) : !aiConfigured ? (
          <div className="rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-sm leading-7 text-amber-900">
            AI 服务尚未配置完成，请填写服务地址与模型。
          </div>
        ) : null}

        <div>
          <label className="text-sm font-semibold text-slate-700" htmlFor="ai-generate-description">
            请求描述
          </label>
          <Textarea
            id="ai-generate-description"
            className="mt-2 min-h-[120px]"
            placeholder="例如：在 users 索引中搜索 status 为 active 且 age 大于 18 的用户，返回前 10 条"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={isGenerating}
          />
        </div>

        {generateError ? (
          <div className="rounded-2xl border border-rose-100 bg-rose-50/70 px-4 py-3 text-sm leading-7 text-rose-800">
            {generateError}
          </div>
        ) : null}

        {showStreaming ? (
          <div className="space-y-3">
            {hasStreamingReasoning ? (
              <div>
                <p className="text-sm font-semibold text-slate-700">AI 思考过程</p>
                <pre className="mt-2 max-h-40 overflow-auto rounded-2xl bg-slate-100 px-4 py-3 text-xs leading-6 text-slate-700">
                  {streamingReasoningText}
                </pre>
              </div>
            ) : null}
            <div>
              <p className="text-sm font-semibold text-slate-700">
                {hasStreamingReasoning ? "生成结果" : "AI 流式输出"}
              </p>
              <pre className="mt-2 max-h-64 overflow-auto rounded-2xl bg-slate-950 px-4 py-3 text-xs leading-6 text-slate-100">
                {streamingContentText || (hasStreamingReasoning ? "思考完成，正在生成请求内容..." : "等待 AI 响应...")}
              </pre>
            </div>
          </div>
        ) : null}

        {generatedContent && !showStreaming ? (
          <div>
            <p className="text-sm font-semibold text-slate-700">生成的请求内容</p>
            <pre className="mt-2 max-h-80 overflow-auto rounded-2xl bg-slate-950 px-4 py-3 text-xs leading-6 text-slate-100">
              {generatedContent}
            </pre>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
