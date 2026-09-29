export function requestAbortError() {
  return new DOMException("请求已取消。", "AbortError");
}

export function isRequestAbort(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function checkRequestAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw requestAbortError();
}
