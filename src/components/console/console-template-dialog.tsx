import type { RequestTemplate } from "../../lib/request-templates";
import { REQUEST_TEMPLATES } from "../../lib/request-templates";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";

export type ConsoleTemplateDialogProps = {
  open: boolean;
  onClose: () => void;
  onApply: (template: RequestTemplate) => void;
};

export function ConsoleTemplateDialog({ open, onClose, onApply }: ConsoleTemplateDialogProps) {
  return (
    <Dialog
      open={open}
      title="请求模板"
      description="选择内置 Elasticsearch 常用请求模板，一键插入到编辑器。"
      onClose={onClose}
      panelClassName="max-w-2xl"
      footer={
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className="grid gap-3">
        {REQUEST_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-emerald-300 hover:bg-emerald-50/40"
            onClick={() => onApply(template)}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-900">{template.name}</span>
              {template.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  {tag}
                </span>
              ))}
            </div>
            <p className="mt-1 text-sm text-slate-500">{template.description}</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 px-3 py-2 text-[11px] leading-5 text-slate-100">
              {template.content}
            </pre>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
