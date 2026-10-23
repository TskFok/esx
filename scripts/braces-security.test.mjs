// @vitest-environment node

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const projectRequire = createRequire(import.meta.url);
const tailwindRequire = createRequire(projectRequire.resolve("tailwindcss"));
const consumers = ["chokidar", "micromatch"].map((name) => {
  const consumerRequire = createRequire(tailwindRequire.resolve(name));
  return [name, consumerRequire("braces")];
});

function nestedPattern(open, close, depth) {
  return open.repeat(depth) + "x" + close.repeat(depth);
}

function nestedAst(depth) {
  const root = { type: "root", nodes: [] };
  let parent = root;
  for (let index = 0; index < depth; index++) {
    const node = { type: "brace", nodes: [], parent, commas: 1 };
    parent.nodes.push(node);
    parent = node;
  }
  parent.nodes.push({ type: "text", value: "x", parent });
  return root;
}

describe.each(consumers)("%s 使用的 braces 安全补丁", (_consumer, braces) => {
  it("保留项目 glob、嵌套分支和范围展开", () => {
    expect(braces.expand("./src/**/*.{ts,tsx}")).toEqual([
      "./src/**/*.ts",
      "./src/**/*.tsx",
    ]);
    expect(braces.expand("a/{b,{c,d}}/{1..2}")).toEqual([
      "a/b/1", "a/b/2", "a/c/1", "a/c/2", "a/d/1", "a/d/2",
    ]);
    expect(braces.compile("file-{a,b}.ts")).toBe("file-(a|b).ts");
  });

  it("保留普通圆括号、转义和引号中的花括号", () => {
    expect(braces.compile("src/(a|b)/{c,d}.ts")).toBe("src/(a|b)/(c|d).ts");
    expect(braces.expand(String.raw`src/\{name\}.ts`)).toEqual(["src/{name}.ts"]);
    expect(braces.expand('src/"{name}".ts')).toEqual(["src/{name}.ts"]);
  });

  it("保留正常深度模式和解析后 AST 的行为", () => {
    const pattern = nestedPattern("{(", ")}", 16);
    expect(braces.compile(pattern)).toBe(pattern);
    expect(braces.expand(pattern)).toEqual([pattern]);
    for (const method of ["compile", "expand", "stringify"]) {
      const ast = braces.parse("a/{b,c}/d");
      const expected = {
        compile: "a/(b|c)/d",
        expand: ["a/b/d", "a/c/d"],
        stringify: "a/{b,c}/d",
      };
      expect(braces[method](ast)).toEqual(expected[method]);
    }
  });

  it.each(["compile", "expand", "stringify"])(
    "%s 明确拒绝字符上限以内的恶意花括号嵌套",
    (method) => {
      expect(() => braces[method](nestedPattern("{", "}", 4500))).toThrow(SyntaxError);
    },
  );

  it.each(["compile", "expand", "stringify"])(
    "%s 明确拒绝纯圆括号深层嵌套",
    (method) => {
      expect(() => braces[method](nestedPattern("(", ")", 4500))).toThrow(SyntaxError);
    },
  );

  it.each(["compile", "expand", "stringify"])(
    "%s 拒绝绕过解析器传入的过深 AST",
    (method) => {
      expect(() => braces[method](nestedAst(12000))).toThrow(SyntaxError);
    },
  );

  it("拒绝混合括号与未闭合容器的深层嵌套", () => {
    expect(() => braces.parse(nestedPattern("{(", ")}", 2200))).toThrow(SyntaxError);
    expect(() => braces.parse("{".repeat(4500))).toThrow(SyntaxError);
  });

  it("展开直接 AST 时拒绝过深的 parent 链", () => {
    let parent = { type: "root", nodes: [], queue: [] };
    for (let index = 0; index < 12000; index++) {
      parent = { type: "paren", nodes: [], parent };
    }
    const ast = {
      type: "root",
      nodes: [{
        type: "paren",
        parent,
        nodes: [{ type: "text", value: "x" }],
      }],
    };
    expect(() => braces.expand(ast)).toThrow(SyntaxError);
  });

  it("调用方选项不能提高安全深度上限", () => {
    expect(() => braces.compile(nestedPattern("{", "}", 4500), {
      maxDepth: Infinity,
      maxLength: Infinity,
    })).toThrow(SyntaxError);
  });
});
