import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./button";

type DialogProps = {
  open: boolean;
  title: string;
  description?: string;
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
  onClose,
  onConfirm,
  confirmDisabled = false,
  children,
  footer,
}: DialogProps) {
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
        className="glass-panel mx-auto flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden border border-white/90 bg-white/95 p-6 sm:p-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div>
            <h3 className="text-2xl font-extrabold text-slate-900">{title}</h3>
            {description ? <p className="mt-2 text-sm leading-7 text-slate-500">{description}</p> : null}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-6 min-h-0 flex-1 overflow-y-auto pr-1">{children}</div>

        {footer ? (
          <div className="mt-6 flex shrink-0 flex-wrap justify-end gap-3 border-t border-slate-200/80 pt-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
