import { CONSOLE_SHORTCUTS, formatConsoleShortcutKeys } from "../../lib/console-shortcuts";
import { Dialog } from "../ui/dialog";

type ConsoleShortcutsDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function ConsoleShortcutsDialog({ open, onClose }: ConsoleShortcutsDialogProps) {
  return (
    <Dialog open={open} title="Console 快捷键" description="在 Console 页可用的键盘操作。" onClose={onClose}>
      <div className="space-y-3">
        {CONSOLE_SHORTCUTS.map((shortcut) => (
          <div
            key={shortcut.id}
            className="flex flex-col gap-2 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900">{shortcut.label}</p>
              <p className="mt-1 text-sm leading-6 text-slate-500">{shortcut.description}</p>
            </div>
            <kbd className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm">
              {formatConsoleShortcutKeys(shortcut)}
            </kbd>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
