import { cache } from "react";
import { RepoEntity, OrgEntity } from "@/lib/contracts";
import { DAILY_BASE_VIEW_OPTS, readView } from "./source";

export const getRepoEntity = cache((id: number) => readView(`entity/repo/${id}.json`, RepoEntity, { base: true }));
export const getOrgEntity = cache((login: string) => readView(`entity/org/${login}.json`, OrgEntity, { base: true }));
export const getRepoEntityDaily = cache((id: number) => readView(`entity/repo/${id}.json`, RepoEntity, DAILY_BASE_VIEW_OPTS));
