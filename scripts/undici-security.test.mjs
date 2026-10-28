// @vitest-environment node

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const projectRequire = createRequire(import.meta.url);
const jsdomRequire = createRequire(projectRequire.resolve("jsdom"));
const { fetch } = jsdomRequire("undici");
const trustedBody = "trusted resource";
const digest = createHash("sha256").update(trustedBody).digest("base64");

// GHSA-f72v-6w45-q472：验证 jsdom 实际解析到的依赖，防止升级后回退到漏洞版本。
describe.each(["sha256", "SHA256", "Sha256"])("undici 的 %s 完整性校验", (algorithm) => {
  const integrity = `${algorithm}-${digest}`;

  it("接受摘要匹配的内容", async () => {
    const response = await fetch(`data:text/plain,${encodeURIComponent(trustedBody)}`, { integrity });
    expect(await response.text()).toBe(trustedBody);
  });

  it("拒绝摘要不匹配的内容", async () => {
    await expect(fetch("data:text/plain,tampered", { integrity })).rejects.toThrow();
  });
});
