import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export function Switch({ className, checked, ...props }: SwitchProps) {
  return (
    <label className={cn("relative inline-flex cursor-pointer items-center", className)}>
      <input className="peer sr-only" type="checkbox" checked={checked} {...props} />
      <span className="h-7 w-12 rounded-full bg-slate-300 transition peer-checked:bg-emerald-500" />
      <span className="absolute left-1 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
    </label>
  );
}
