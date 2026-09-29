import { useEffect, useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./button";

type DialogProps = {
  open: boolean;
  title: string;
  description?: string;
  panelClassName?: string;
  onClose: () => void;
  onConfirm?: () => void;
  confirmDisabled?: boolean;
  children: ReactNode;
  footer?: ReactNode;
};

export function Dialog({
  open,
  title,
  description,
  panelClassName,
  onClose,
  onConfirm,
  confirmDisabled = false,
  children,
  footer,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Enter" || !onConfirm || confirmDisabled || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement) {
        return;
      }

      event.preventDefault();
      onConfirm();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [confirmDisabled, onClose, onConfirm, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/45 p-4 sm:flex sm:items-center sm:justify-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={`mx-auto flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-lg border border-border bg-white p-5 shadow-panel sm:p-6 ${panelClassName ?? "max-w-2xl"}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div>
            <h3 id={titleId} className="text-lg font-semibold text-slate-900">{title}</h3>
            {description ? <p id={descriptionId} className="mt-1 text-xs leading-5 text-slate-600">{description}</p> : null}
          </div>
          <Button variant="ghost" size="icon" aria-label="关闭弹窗" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">{children}</div>

        {footer ? (
          <div className="mt-5 flex shrink-0 flex-wrap justify-end gap-2 border-t border-border pt-4 sm:flex-nowrap">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
