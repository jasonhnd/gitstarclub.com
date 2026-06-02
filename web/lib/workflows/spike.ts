// SPIKE ONLY — verifies the Vercel Workflow SDK ("use workflow"/"use step")
// compiles and bundles under Next 16 + bun. Delete once M2+ lands the real
// refresh workflow. See docs/VERCEL-DATA-OPERATIONS.md §3.

export async function spikeWorkflow(runId: string): Promise<{ runId: string; len: number }> {
  "use workflow";

  const len = await spikeStep(runId);
  return { runId, len };
}

async function spikeStep(runId: string): Promise<number> {
  "use step";

  // A step is a normal async function with full Node access; built-in retries.
  return runId.length;
}
