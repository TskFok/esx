import { useEffect, type ReactNode } from "react";

type ConsoleMobileDrawerProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  closeLabel?: string;
  side?: "left" | "right";
};

export function ConsoleMobileDrawer({
  open,
  onClose,
  children,
  closeLabel = "关闭连接与请求抽屉",
  side = "left",
}: ConsoleMobileDrawerProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/45"
        aria-label={closeLabel}
        onClick={onClose}
      />
      <aside
        className={
          side === "right"
            ? "absolute inset-y-0 right-0 flex w-[min(calc(100vw-2rem),400px)] max-w-full flex-col overflow-hidden rounded-l-2xl bg-white px-3 py-3 text-slate-900 shadow-xl shadow-slate-900/20"
            : "absolute inset-y-0 left-0 flex w-[min(calc(100vw-3rem),320px)] max-w-full flex-col overflow-hidden rounded-r-2xl bg-slate-950 px-3 py-3 text-slate-50 shadow-xl shadow-slate-900/25"
        }
      >
        {children}
      </aside>
    </div>
  );
}
