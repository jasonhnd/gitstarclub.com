import { cache } from "react";
import { Narrative } from "@/lib/contracts";
import { readView } from "./source";

/** Flat, durable monthly narrative (v0.2 §2); absent → null so the page renders nothing. */
export const getNarrative = cache((period: string) => readView(`narrative/${period}.json`, Narrative));
