import { getAdapter } from "../lib/sources";
import { registry } from "../lib/registry";

let missing = 0;
for (const s of registry.sources.filter((x) => x.enabled)) {
  if (!getAdapter(s)) {
    console.log("MISSING ADAPTER:", s.id);
    missing++;
  }
}
console.log(`enabled sources: ${registry.sources.filter((x) => x.enabled).length}, missing adapters: ${missing}`);