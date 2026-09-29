import * as React from "react";
import { cn } from "../../lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    autoCapitalize="off"
    autoCorrect="off"
    autoComplete="off"
    spellCheck={false}
    className={cn(
      "flex min-h-[120px] w-full min-w-0 rounded-md border border-input bg-white px-3 py-2 text-xs leading-6 text-foreground outline-none transition-colors placeholder:text-slate-500 focus:border-primary focus:ring-2 focus:ring-primary/15 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    ref={ref}
    {...props}
  />
));

Textarea.displayName = "Textarea";

export { Textarea };
