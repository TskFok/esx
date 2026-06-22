import { describe, expect, it } from "vitest";
import {
  decryptJsonPayload,
  encryptJsonPayload,
  isEncryptedJsonFile,
  serializeEncryptedJsonFile,
} from "../export-crypto";

describe("export crypto", () => {
  it("encrypts and decrypts json payloads by kind", async () => {
    const encrypted = await encryptJsonPayload({
      kind: "connections",
      password: "test-password",
      payload: { version: 1, name: "生产集群" },
    });

    expect(isEncryptedJsonFile(encrypted, "connections")).toBe(true);
    expect(serializeEncryptedJsonFile(encrypted)).toContain('"kind": "connections"');

    const decrypted = await decryptJsonPayload<{ version: number; name: string }>({
      file: encrypted,
      kind: "connections",
      password: "test-password",
    });

    expect(decrypted).toEqual({ version: 1, name: "生产集群" });
  });

  it("rejects empty encryption passwords", async () => {
    await expect(
      encryptJsonPayload({
        kind: "connections",
        password: " ",
        payload: { version: 1 },
      }),
    ).rejects.toThrow("加密导出需要设置密码。");
  });

  it("rejects wrong passwords", async () => {
    const encrypted = await encryptJsonPayload({
      kind: "connections",
      password: "right-password",
      payload: { version: 1 },
    });

    await expect(
      decryptJsonPayload({
        file: encrypted,
        kind: "connections",
        password: "wrong-password",
      }),
    ).rejects.toThrow("密码错误或文件已损坏。");
  });

  it("rejects files for another export kind", async () => {
    const encrypted = await encryptJsonPayload({
      kind: "requests",
      password: "test-password",
      payload: { version: 1 },
    });

    expect(isEncryptedJsonFile(encrypted, "connections")).toBe(false);
    await expect(
      decryptJsonPayload({
        file: encrypted,
        kind: "connections",
        password: "test-password",
      }),
    ).rejects.toThrow("不支持的连接导入文件。");
  });
});
