#!/usr/bin/env node

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

import { checkSchemaDrift } from "./check-schema-drift.mjs";

const marker = "-- CI schema-drift negative fixture: this must be detected\n";
const injectedSql =
  "\ncreate table public.__ci_schema_drift_probe (id integer);\n";

function main() {
  const schemaPath = "supabase/schemas/01_tables.sql";
  const original = readFileSync(schemaPath, "utf8");
  try {
    appendFileSync(schemaPath, `${marker}${injectedSql}`);
    try {
      checkSchemaDrift(process.env.STACK_WORKDIR ?? ".supabase-e2e");
    } catch (error) {
      if (/DECLARATIVE SCHEMA DRIFT DETECTED/.test(error.message)) {
        console.log("schema drift negative test PASSED: drift was rejected");
        return;
      }
      throw error;
    }
    throw new Error("schema drift guard unexpectedly accepted injected drift");
  } finally {
    writeFileSync(schemaPath, original);
  }
}

try {
  main();
} catch (error) {
  console.error(`schema drift negative test FAILED: ${error.message}`);
  process.exit(1);
}
