import { neon } from "@neondatabase/serverless";
import type { NeonQueryFunction } from "@neondatabase/serverless";

// neon() throws if given an empty string, so only call it when DATABASE_URL is set.
// Routes with `export const dynamic = "force-dynamic"` never execute DB calls at build time.
const sql: NeonQueryFunction<false, false> = process.env.DATABASE_URL
  ? neon(process.env.DATABASE_URL)
  : (() => {
      throw new Error("DATABASE_URL not set");
    }) as unknown as NeonQueryFunction<false, false>;

export default sql;
