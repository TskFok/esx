/** @typedef {{ current: boolean; dryRun: boolean; bumpLevel: "patch" | "minor" | "major" }} ReleaseOptions */

/**
 * @param {string[]} argv
 * @returns {ReleaseOptions}
 */
export function parseReleaseArgs(argv) {
  /** @type {ReleaseOptions} */
  const options = {
    current: false,
    dryRun: false,
    bumpLevel: "patch",
  };

  for (const arg of argv) {
    switch (arg) {
      case "--current":
        options.current = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--patch":
        options.bumpLevel = "patch";
        break;
      case "--minor":
        options.bumpLevel = "minor";
        break;
      case "--major":
        options.bumpLevel = "major";
        break;
      default:
        throw new Error(`未知参数：${arg}`);
    }
  }

  if (options.current && options.bumpLevel !== "patch") {
    throw new Error("--current 不能与 --minor / --major 同时使用");
  }

  return options;
}
