import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** A detached clone keeps all unmodified web build output under the card directory. */
export function prepareWebOutput() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const scratch = process.env.KANBAN_TMP;
  if (!scratch) throw new Error("Set KANBAN_TMP before building web for comparison.");
  const location = relative(resolve(scratch), root);
  if (!location || location.startsWith("..")) throw new Error("Run compare:local from a fresh detached verification clone under KANBAN_TMP, as required by AGENTS.md.");
}

if (import.meta.main) prepareWebOutput();
