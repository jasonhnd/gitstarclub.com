import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";

/** cf beta.18 reads .cloudflare from cwd and rejects symlinks, including the root. */
export function preparePrebuiltDeploy(scratch: string, cli: string, mode: "pre" | "production" = "pre") {
  const cwd = mkdtempSync(resolve(scratch, "astro-deploy-"));
  try {
    cpSync(resolve(scratch, "astro-cloudflare"), resolve(cwd, ".cloudflare"), {
      recursive: true, dereference: true,
    });
    return {
      cmd: ["node", cli, "deploy", "--prebuilt", "--mode", mode, "--no-provision"],
      cwd,
    };
  } catch (error) {
    rmSync(cwd, { recursive: true, force: true });
    throw error;
  }
}
