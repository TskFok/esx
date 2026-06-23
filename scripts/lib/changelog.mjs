#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import path from "node:path";
import { generateReleaseNotes, parseChangelogArgs } from "./changelog-lib.mjs";

const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  try {
    const notes = generateReleaseNotes(parseChangelogArgs(process.argv.slice(2)));
    console.log(notes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`changelog 失败：${message}`);
    process.exit(1);
  }
}
