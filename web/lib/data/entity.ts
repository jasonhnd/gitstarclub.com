import { cache } from "react";
import { z } from "zod";
import { RepoEntity, OrgEntity } from "@/lib/contracts";
import { normalizeRepoPageEntity } from "@/lib/repo-readiness";
import { DAILY_BASE_VIEW_OPTS, readView } from "./source";

const UnknownView = z.unknown();

export const getRepoEntity = cache((id: number) => readView(`entity/repo/${id}.json`, RepoEntity, { base: true }));
export const getOrgEntity = cache((login: string) => readView(`entity/org/${login}.json`, OrgEntity, { base: true }));
export const getRepoEntityDaily = cache((id: number) => readView(`entity/repo/${id}.json`, RepoEntity, DAILY_BASE_VIEW_OPTS));
export const getOrgEntityDaily = cache((login: string) => readView(`entity/org/${login}.json`, OrgEntity, DAILY_BASE_VIEW_OPTS));

export const getRepoPageEntityDaily = cache(async (id: number) => {
  const raw = await readView(`entity/repo/${id}.json`, UnknownView, DAILY_BASE_VIEW_OPTS);
  return normalizeRepoPageEntity(raw, id);
});
