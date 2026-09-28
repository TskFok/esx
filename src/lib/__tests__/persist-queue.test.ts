import { afterEach, describe, expect, it, vi } from "vitest";
import { createPersistQueue } from "../persist-queue";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe("createPersistQueue", () => {
  it("合并等待中的连续修改，只写入最新值", async () => {
    vi.useFakeTimers();
    const written: string[] = [];
    const queue = createPersistQueue({ write: async (value: string) => { written.push(value); }, merge: (_old, newer) => newer });
    queue.schedule("A");
    queue.schedule("B");
    queue.schedule("C");
    await queue.flush();
    expect(written).toEqual(["C"]);
    expect(queue.isDirty()).toBe(false);
  });

  it("flush 等待写入期间新增的版本", async () => {
    const first = deferred();
    const second = deferred();
    const written: string[] = [];
    const queue = createPersistQueue({ write: (value: string) => { written.push(value); return value === "A" ? first.promise : second.promise; }, merge: (_old, newer) => newer });
    queue.schedule("A");
    let settled = false;
    const flushing = queue.flush().then(() => { settled = true; });
    expect(written).toEqual(["A"]);
    queue.schedule("B");
    first.resolve();
    await first.promise;
    await vi.waitFor(() => expect(written).toEqual(["A", "B"]));
    expect(settled).toBe(false);
    second.resolve();
    await flushing;
    expect(queue.isDirty()).toBe(false);
  });

  it("写入失败保留最新数据，下一次 flush 可重试", async () => {
    const first = deferred();
    const written: string[] = [];
    const queue = createPersistQueue({ write: (value: string) => { written.push(value); return written.length === 1 ? first.promise : Promise.resolve(); }, merge: (_old, newer) => newer });
    queue.schedule("A");
    const failedFlush = queue.flush();
    queue.schedule("B");
    first.reject(new Error("disk unavailable"));
    await expect(failedFlush).rejects.toThrow("disk unavailable");
    expect(queue.isDirty()).toBe(true);
    expect(written).toEqual(["A"]);
    await queue.flush();
    expect(written).toEqual(["A", "B"]);
    expect(queue.isDirty()).toBe(false);
  });

  it("并发 flush 均等待写入中新增的版本", async () => {
    const first = deferred();
    const second = deferred();
    const written: string[] = [];
    const queue = createPersistQueue({
      write: (value: string) => { written.push(value); return value === "A" ? first.promise : second.promise; },
      merge: (_old, newer) => newer,
    });
    queue.schedule("A");
    let firstSettled = false;
    let secondSettled = false;
    const firstFlush = queue.flush().then(() => { firstSettled = true; });
    const secondFlush = queue.flush().then(() => { secondSettled = true; });
    queue.schedule("B");
    first.resolve();
    await vi.waitFor(() => expect(written).toEqual(["A", "B"]));
    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);
    second.resolve();
    await Promise.all([firstFlush, secondFlush]);
    expect(queue.isDirty()).toBe(false);
  });
});
