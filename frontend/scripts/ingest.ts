// Local ingest runner (uses DATABASE_URL from env).
// Usage: npm run ingest            -> run all due sources (quota-aware)
//        npm run ingest greenhouse -> run one source now
import { runSource, runDueSources } from "../lib/runner";
import { sql } from "../lib/db/client";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const sourceId = process.argv[2];
  if (sourceId) {
    console.log(await runSource(sourceId));
  } else {
    for (const r of await runDueSources()) console.log(r);
  }
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });