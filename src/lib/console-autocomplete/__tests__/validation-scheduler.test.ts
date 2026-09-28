import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleValidationScheduler } from "../validation-scheduler";

describe("createConsoleValidationScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces until 120 ms and publishes only the latest version", () => {
    let content = "POST /_search\n[";
    let version = 1;
    const publish = vi.fn();
    const scheduler = createConsoleValidationScheduler(
      { getValue: () => content, getVersionId: () => version },
      publish,
    );

    scheduler.schedule();
    vi.advanceTimersByTime(60);
    content = "POST /_search\n]";
    version = 2;
    scheduler.schedule();
    vi.advanceTimersByTime(119);
    expect(publish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[0]).toMatchObject([
      { message: "多余的 ]", startLineNumber: 2, startColumn: 1 },
    ]);
  });

  it("does not publish when the model version changed without rescheduling", () => {
    let version = 1;
    const publish = vi.fn();
    const scheduler = createConsoleValidationScheduler(
      { getValue: () => "POST /_search\n[", getVersionId: () => version },
      publish,
    );
    scheduler.schedule();
    version = 2;
    vi.advanceTimersByTime(120);
    expect(publish).not.toHaveBeenCalled();
  });

  it("cancels a queued validation on dispose", () => {
    const publish = vi.fn();
    const scheduler = createConsoleValidationScheduler(
      { getValue: () => "POST /_search\n[", getVersionId: () => 1 },
      publish,
    );
    scheduler.schedule();
    scheduler.dispose();
    vi.advanceTimersByTime(120);
    expect(publish).not.toHaveBeenCalled();
  });
});
