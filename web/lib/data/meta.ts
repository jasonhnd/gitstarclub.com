import { cache } from "react";
import { Meta } from "@/lib/contracts";
import { readView } from "./source";

/** Bump in lockstep with pipeline meta.schema_ver on breaking view-shape changes. */
export const SCHEMA_VER = 1;

export const getMeta = cache((versionTtlMs?: number) =>
  readView("meta.json", Meta, versionTtlMs ? { base: true, versionTtlMs } : { base: true }),
);
