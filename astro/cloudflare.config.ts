import { defineConfig } from "cf/config";
import { accountId } from "../web/host-contract.mjs";
import { astroHostWorker } from "./host-contract.ts";
export { astroHostWorker };

export default defineConfig(({ mode }) => ({ accountId, worker: astroHostWorker(mode ?? "", process.env) }));
