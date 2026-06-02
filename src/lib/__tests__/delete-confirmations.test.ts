import { describe, expect, it } from "vitest";
import {
  buildConnectionDeleteDescription,
  buildSshProfileDeleteDescription,
} from "../delete-confirmations";

describe("buildConnectionDeleteDescription", () => {
  it("includes the connection name and saved request warning", () => {
    expect(buildConnectionDeleteDescription({ name: "生产集群" })).toBe(
      "确定删除连接“生产集群”吗？该连接下的已保存请求也会一起删除。",
    );
  });
});

describe("buildSshProfileDeleteDescription", () => {
  it("warns about linked connections when the profile is in use", () => {
    expect(buildSshProfileDeleteDescription({ name: "跳板机 A" }, 2)).toBe(
      "确定删除 SSH 通道“跳板机 A”吗？当前有 2 个连接正在使用该通道，删除后会自动取消关联。",
    );
  });

  it("uses a simple irreversible warning when no connections use the profile", () => {
    expect(buildSshProfileDeleteDescription({ name: "跳板机 B" }, 0)).toBe(
      "确定删除 SSH 通道“跳板机 B”吗？删除后该通道无法恢复。",
    );
  });
});
