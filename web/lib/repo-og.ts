import { isRenderableRepoFullName } from "./repo-readiness";

export type RepoOpenGraphSource = {
  full_name: string;
  current_stars: number;
  language: string | null;
};

export type RepoOpenGraphCard =
  | { kind: "generic" }
  | {
      kind: "repo";
      fullName: string;
      stars: number;
      language: string | null;
      titleSize: number;
    };

// The repository share image may paint a name only after the URL resolved to a
// known repo id and the stored entity has a renderable full_name. Callers pass
// that stored entity, never the raw path: GHSA-vcvr-r3jv-pc5j is triggered when
// attacker-controlled text reaches next/og ImageResponse.
export function repoOpenGraphCard(repoId: number | undefined, repo: RepoOpenGraphSource | null): RepoOpenGraphCard {
  if (repoId === undefined || repo === null || !isRenderableRepoFullName(repo.full_name)) {
    return { kind: "generic" };
  }
  const fullName = repo.full_name;
  const titleSize = fullName.length > 28 ? 56 : fullName.length > 18 ? 72 : 88;
  const language = repo.language && repo.language.length > 0 ? repo.language : null;
  return { kind: "repo", fullName, stars: repo.current_stars, language, titleSize };
}
