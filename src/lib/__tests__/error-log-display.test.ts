import { describe, expect, it } from "vitest";
import { getErrorLogScopeLabel, getErrorLogsEmptyDescription } from "../error-log-display";

describe("getErrorLogScopeLabel", () => {
  it("maps known scopes to Chinese labels", () => {
    expect(getErrorLogScopeLabel("connection-save")).toBe("连接保存");
    expect(getErrorLogScopeLabel("connection-test")).toBe("连接测试");
    expect(getErrorLogScopeLabel("request-execution")).toBe("请求执行");
    expect(getErrorLogScopeLabel("request-audit")).toBe("操作审计");
    expect(getErrorLogScopeLabel("status-read")).toBe("状态读取");
  });
});

describe("getErrorLogsEmptyDescription", () => {
  it("explains next steps when collection is enabled", () => {
    expect(getErrorLogsEmptyDescription(true)).toContain("诊断日志采集已开启");
  });

  it("asks user to enable collection when disabled", () => {
    expect(getErrorLogsEmptyDescription(false)).toContain("请开启日志采集后复现问题");
  });
});
