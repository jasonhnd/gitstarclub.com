export type PreviewIdentity = {
  commitSha: string | null;
  deploymentUrl: string | null;
  target?: "vercel" | "cf";
  host?: string;
};

export type PreviewDiscovery =
  | { kind: "identity-origin"; origin: string }
  | { kind: "check-run" };
