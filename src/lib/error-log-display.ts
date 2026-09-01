import type { ErrorLogScope } from "../types/logs";

export const ERROR_LOG_SCOPE_LABELS: Record<ErrorLogScope, string> = {
  "connection-save": "连接保存",
  "connection-test": "连接测试",
  "request-execution": "请求执行",
  "request-audit": "操作审计",
  "status-read": "状态读取",
};

export function getErrorLogScopeLabel(scope: ErrorLogScope): string {
  return ERROR_LOG_SCOPE_LABELS[scope];
}

export function getErrorLogsEmptyDescription(enabled: boolean): string {
  if (enabled) {
    return "诊断日志采集已开启，后续失败诊断和操作审计会记录在这里。";
  }

  return "写入/管理操作审计会自动记录；如需失败诊断，请开启日志采集后复现问题。";
}
