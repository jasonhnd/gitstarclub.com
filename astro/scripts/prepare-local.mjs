import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, isAbsolute } from "node:path";

const scratch = process.env.KANBAN_TMP;
if (!scratch || !isAbsolute(scratch)) throw new Error("Set KANBAN_TMP to an absolute card-local directory.");
for (const [link, name] of [[".astro", "astro-types"], [".cloudflare", "astro-cloudflare"]]) {
  const target = resolve(scratch, name);
  mkdirSync(target, { recursive: true });
  if (existsSync(link) || (() => { try { return lstatSync(link).isSymbolicLink(); } catch { return false; } })()) {
    if (!lstatSync(link).isSymbolicLink() || readlinkSync(link) !== target) {
      throw new Error(`Move generated ${link} to ${target} before continuing; refusing to delete existing files.`);
    }
  } else {
    symlinkSync(target, link, "dir");
  }
}
const exclude = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], { encoding: "utf8" }).trim();
const prior = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
for (const pattern of [".kanban-work/", "/astro/.astro", "/astro/.cloudflare"]) {
  if (!prior.split("\n").includes(pattern)) appendFileSync(exclude, `\n${pattern}\n`);
}
