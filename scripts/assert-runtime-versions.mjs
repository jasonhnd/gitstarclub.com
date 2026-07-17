import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function expectedBunVersion(packageManager) {
  const match = /^bun@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(packageManager.trim());
  if (!match) throw new Error(`root packageManager must pin Bun exactly; received ${JSON.stringify(packageManager)}`);
  return match[1];
}

export function assertRuntimeVersions({ expectedNodeMajor, actualNodeVersion, expectedBun, actualBun }) {
  const actualNodeMajor = actualNodeVersion.replace(/^v/, "").split(".")[0];
  const failures = [];
  if (actualNodeMajor !== expectedNodeMajor) {
    failures.push(`Node major mismatch: expected ${expectedNodeMajor}.x, received ${actualNodeVersion}`);
  }
  if (actualBun !== expectedBun) {
    failures.push(`Bun mismatch: expected ${expectedBun}, received ${actualBun}`);
  }
  if (failures.length > 0) throw new Error(failures.join("; "));
  return { node: actualNodeVersion, bun: actualBun };
}

export function verifyRepositoryRuntimeVersions(root = repoRoot) {
  const expectedNodeMajor = readFileSync(resolve(root, ".node-version"), "utf8").trim();
  const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const expectedBun = expectedBunVersion(rootPackage.packageManager ?? "");
  const actualNodeVersion = process.version;
  const actualBun = execFileSync("bun", ["--version"], { encoding: "utf8" }).trim();
  return assertRuntimeVersions({ expectedNodeMajor, actualNodeVersion, expectedBun, actualBun });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    const versions = verifyRepositoryRuntimeVersions();
    console.log(`runtime contract satisfied: Node ${versions.node}; Bun ${versions.bun}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
