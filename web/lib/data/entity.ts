import { cache } from "react";
import { RepoEntity, OrgEntity } from "@/lib/contracts";
import { readView } from "./source";

export const getRepoEntity = cache((id: number) => readView(`entity/repo/${id}.json`, RepoEntity, { base: true }));
export const getOrgEntity = cache((login: string) => readView(`entity/org/${login}.json`, OrgEntity, { base: true }));
