export function createPersistQueue<T>(options: {
  write: (value: T) => Promise<void>;
  merge: (pending: T, newer: T) => T;
  delayMs?: number;
}) {
  let pending: { value: T } | null = null;
  let writing: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function drain() {
    while (pending !== null) {
      const current = pending.value;
      pending = null;
      try {
        await options.write(current);
      } catch (error) {
        const newer = pending as { value: T } | null;
        pending = { value: newer === null ? current : options.merge(current, newer.value) };
        throw error;
      }
    }
  }

  async function flush(): Promise<void> {
    clearTimer();
    while (pending !== null || writing !== null) {
      if (writing === null) {
        const task = drain();
        writing = task;
        void task.finally(() => {
          if (writing === task) writing = null;
        }).catch(() => undefined);
      }
      const active = writing;
      await active;
      if (writing === active) writing = null;
    }
  }

  function schedule(value: T) {
    pending = { value: pending === null ? value : options.merge(pending.value, value) };
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void flush().catch(() => undefined);
    }, options.delayMs ?? 300);
  }

  return { schedule, flush, isDirty: () => pending !== null || writing !== null };
}
