import type { Publication } from "../../web/lib/workers-host/publication-fence";
import type { pageData } from "./lib/data";

declare global {
  namespace App {
    interface Locals {
      publication: Publication;
      data: ReturnType<typeof pageData>;
      invalidatePaths: (paths: string[]) => Promise<void>;
    }
  }
}
export {};
