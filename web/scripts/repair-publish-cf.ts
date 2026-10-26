/** One raw-body boundary for the repository-pinned cf. Never downloads a CLI. */
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export type CfRunner = (args: string[], child: { env: NodeJS.ProcessEnv }) => Promise<{
  code: number; stdout: string | Buffer; stderr: string;
}>;
const execute = promisify(execFile);
export const cfChild = () => ({ env: { ...process.env, CF_DELEGATION: "1" } });

export const runCf: CfRunner = async (args, child) => {
  try {
    const { stdout, stderr } = await execute(fileURLToPath(new URL("../node_modules/.bin/cf", import.meta.url)), args,
      { encoding: "buffer", maxBuffer: 320 * 1024 * 1024, env: { ...child.env, CF_DELEGATION: "1" } });
    return { code: 0, stdout, stderr: stderr.toString("utf8") };
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: Buffer; stderr?: Buffer };
    if (typeof failure.code !== "number") throw error;
    return { code: failure.code, stdout: failure.stdout ?? Buffer.alloc(0), stderr: failure.stderr?.toString("utf8") ?? "" };
  }
};

export async function cfBytes(runner: CfRunner, args: string[]): Promise<Buffer> {
  const result = await runner(args, cfChild());
  if (result.code !== 0) throw new Error(`cf ${args[2]} failed (${result.code}): ${result.stderr}`);
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
}
