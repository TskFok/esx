import { Check, HelpCircle, LayoutTemplate, Loader2, Settings2, Sparkles, Wand2 } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  CONSOLE_REQUEST_NAME_INPUT_CLASS,
  CONSOLE_REQUEST_TOOLBAR_CLASS,
  CONSOLE_TOOLBAR_ACTIONS_CLASS,
  CONSOLE_TOOLBAR_BUTTON_CLASS,
  CONSOLE_TOOLBAR_ICON_CLASS,
} from "../../lib/console-toolbar";

export type ConsoleRequestToolbarProps = {
  requestName: string;
  isAnalyzing: boolean;
  isGenerating: boolean;
  onRequestNameChange: (value: string) => void;
  onRunAndSave: () => void;
  onFormatJson: () => void;
  onAnalyze: () => void;
  onGenerate: () => void;
  onOpenTemplates: () => void;
  onOpenAiSettings: () => void;
  onOpenShortcuts: () => void;
};

export function ConsoleRequestToolbar({
  requestName,
  isAnalyzing,
  isGenerating,
  onRequestNameChange,
  onRunAndSave,
  onFormatJson,
  onAnalyze,
  onGenerate,
  onOpenTemplates,
  onOpenAiSettings,
  onOpenShortcuts,
}: ConsoleRequestToolbarProps) {
  return (
    <div className={CONSOLE_REQUEST_TOOLBAR_CLASS} data-testid="console-request-toolbar">
      <div className={CONSOLE_TOOLBAR_ACTIONS_CLASS} data-testid="console-toolbar-actions">
        <Button variant="outline" className={CONSOLE_TOOLBAR_BUTTON_CLASS} onClick={onFormatJson}>
          <Check className={CONSOLE_TOOLBAR_ICON_CLASS} />
          格式化 JSON
        </Button>
        <Button
          variant="outline"
          className={CONSOLE_TOOLBAR_BUTTON_CLASS}
          onClick={onAnalyze}
          disabled={isAnalyzing}
          title="AI 分析 (⌘⇧A)"
        >
          {isAnalyzing ? (
            <Loader2 className={`${CONSOLE_TOOLBAR_ICON_CLASS} animate-spin`} />
          ) : (
            <Sparkles className={CONSOLE_TOOLBAR_ICON_CLASS} />
          )}
          AI 分析
        </Button>
        <Button
          variant="outline"
          className={CONSOLE_TOOLBAR_BUTTON_CLASS}
          onClick={onGenerate}
          disabled={isGenerating}
          title="AI 生成请求"
        >
          {isGenerating ? (
            <Loader2 className={`${CONSOLE_TOOLBAR_ICON_CLASS} animate-spin`} />
          ) : (
            <Wand2 className={CONSOLE_TOOLBAR_ICON_CLASS} />
          )}
          AI 生成
        </Button>
        <Button
          variant="outline"
          className={CONSOLE_TOOLBAR_BUTTON_CLASS}
          onClick={onOpenTemplates}
          title="请求模板"
        >
          <LayoutTemplate className={CONSOLE_TOOLBAR_ICON_CLASS} />
          模板
        </Button>
        <Button
          variant="outline"
          className={CONSOLE_TOOLBAR_BUTTON_CLASS}
          title="AI 分析设置"
          aria-label="AI 分析设置"
          onClick={onOpenAiSettings}
        >
          <Settings2 className={CONSOLE_TOOLBAR_ICON_CLASS} />
          AI 设置
        </Button>
        <Button
          variant="outline"
          className={CONSOLE_TOOLBAR_BUTTON_CLASS}
          title="快捷键帮助 (? 或 ⌘/)"
          aria-label="快捷键帮助"
          onClick={onOpenShortcuts}
        >
          <HelpCircle className={CONSOLE_TOOLBAR_ICON_CLASS} />
          快捷键
        </Button>
      </div>
      <Input
        className={CONSOLE_REQUEST_NAME_INPUT_CLASS}
        value={requestName}
        onChange={(event) => onRequestNameChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) {
            return;
          }

          event.preventDefault();
          onRunAndSave();
        }}
        placeholder="请求名称（为空时默认使用 METHOD /path，Command + Enter 运行并保存）"
      />
    </div>
  );
}
