import { cache } from "react";
import { z } from "zod";
import { RepoEntity, OrgEntity } from "@/lib/contracts";
import { githubLogin, isGithubRepoId } from "@/lib/public-params";
import { normalizeRepoPageEntity } from "@/lib/repo-readiness";
import { DAILY_BASE_VIEW_OPTS, readView } from "./source";

const UnknownView = z.unknown();

export const getRepoEntity = cache(async (id: number) => isGithubRepoId(id) ? readView(`entity/repo/${id}.json`, RepoEntity, { base: true }) : null);
export const getRepoEntityDaily = cache(async (id: number) => isGithubRepoId(id) ? readView(`entity/repo/${id}.json`, RepoEntity, DAILY_BASE_VIEW_OPTS) : null);
export const getOrgEntityDaily = cache(async (login: string) => githubLogin(login) ? readView(`entity/org/${login}.json`, OrgEntity, DAILY_BASE_VIEW_OPTS) : null);

export const getRepoPageEntityDaily = cache(async (id: number) => {
  if (!isGithubRepoId(id)) return null;
  const raw = await readView(`entity/repo/${id}.json`, UnknownView, DAILY_BASE_VIEW_OPTS);
  return normalizeRepoPageEntity(raw, id);
});
