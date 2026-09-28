import { validateConsoleContent, type ConsoleBodyDiagnostic } from "./validator";

type ValidationModel = {
  getValue(): string;
  getVersionId(): number;
};

export function createConsoleValidationScheduler(
  model: ValidationModel,
  publish: (diagnostics: ConsoleBodyDiagnostic[]) => void,
  delayMs = 120,
): { schedule(): void; dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  return {
    schedule() {
      if (disposed) {
        return;
      }
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      const scheduledVersion = model.getVersionId();
      timer = setTimeout(() => {
        timer = undefined;
        if (disposed || model.getVersionId() !== scheduledVersion) {
          return;
        }
        const diagnostics = validateConsoleContent(model.getValue());
        if (!disposed && model.getVersionId() === scheduledVersion) {
          publish(diagnostics);
        }
      }, delayMs);
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}
