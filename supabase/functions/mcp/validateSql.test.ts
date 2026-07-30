// @vitest-environment node
import { describe, it, expect } from "vitest";
import { validateReadOnly, validateWrite } from "./validateSql";

describe("validateReadOnly", () => {
  it.each([
    ["simple SELECT", "SELECT * FROM shidduchim"],
    [
      "SELECT with WHERE",
      "SELECT id, name_en FROM shidduchim WHERE created_at > NOW() - INTERVAL '30 days'",
    ],
    [
      "SELECT with JOIN",
      "SELECT s.name_en, sh.name FROM shidduchim s JOIN shadchanim sh ON s.shadchan_id = sh.id",
    ],
    [
      "SELECT with subquery",
      "SELECT * FROM shidduchim WHERE shadchan_id IN (SELECT id FROM shadchanim WHERE location = 'Lakewood')",
    ],
    [
      "read-only CTE",
      "WITH recent AS (SELECT * FROM shidduchim WHERE created_at > NOW() - INTERVAL '7 days') SELECT * FROM recent",
    ],
    [
      "aggregate query",
      "SELECT COUNT(*) as total, type FROM tasks GROUP BY type",
    ],
    [
      "DELETE in string literal",
      "SELECT * FROM shidduchim WHERE pipeline_state = 'DELETE'",
    ],
    [
      "DROP in string literal",
      "SELECT * FROM logs WHERE message = 'DROP TABLE failed'",
    ],
    [
      "UPDATE in string literal",
      "SELECT * FROM shidduchim WHERE father_en = 'Please UPDATE your info'",
    ],
    [
      "DROP in block comment",
      "SELECT /* DROP TABLE shidduchim */ * FROM shidduchim",
    ],
    [
      "DROP in line comment",
      "SELECT * FROM shidduchim -- DROP TABLE shidduchim",
    ],
  ])("allows %s", (_label, sql) => {
    expect(validateReadOnly(sql)).toBeNull();
  });

  it.each([
    ["INSERT", "INSERT INTO shidduchim (name_en) VALUES ('test')"],
    ["UPDATE", "UPDATE shidduchim SET name_en = 'test'"],
    ["DELETE", "DELETE FROM shidduchim WHERE id = 1"],
    [
      "writable CTE (DELETE)",
      "WITH d AS (DELETE FROM shidduchim RETURNING *) SELECT * FROM d",
    ],
    [
      "writable CTE (UPDATE)",
      "WITH u AS (UPDATE shidduchim SET name_en = 'x' RETURNING *) SELECT * FROM u",
    ],
    [
      "writable CTE (INSERT)",
      "WITH i AS (INSERT INTO shidduchim (name_en) VALUES ('x') RETURNING *) SELECT * FROM i",
    ],
    ["DROP TABLE", "DROP TABLE shidduchim"],
    ["CREATE TABLE", "CREATE TABLE evil (id int)"],
    ["ALTER TABLE", "ALTER TABLE shidduchim ADD COLUMN x int"],
    ["TRUNCATE", "TRUNCATE shidduchim"],
    ["SET", "SET LOCAL role = 'postgres'"],
    ["DO block", "DO $$ BEGIN END $$"],
    ["multi-statement (SELECT; DROP)", "SELECT 1; DROP TABLE shidduchim"],
    ["multi-statement (SELECT; SET)", "SELECT 1; SET LOCAL role = 'postgres'"],
    ["multi-statement (two SELECTs)", "SELECT 1; SELECT 2"],
    ["unparseable SQL", "NOT VALID SQL %%%"],
  ])("rejects %s", (_label, sql) => {
    expect(validateReadOnly(sql)).not.toBeNull();
  });
});

describe("validateWrite", () => {
  it.each([
    [
      "INSERT",
      "INSERT INTO shidduchim (name_en, name_he) VALUES ('Chaim', 'חיים')",
    ],
    ["UPDATE", "UPDATE shidduchim SET name_en = 'test' WHERE id = 1"],
    ["DELETE", "DELETE FROM shidduchim WHERE id = 1"],
    [
      "INSERT with RETURNING",
      "INSERT INTO shidduchim (name_en) VALUES ('test') RETURNING id",
    ],
    [
      "UPDATE with subquery",
      "UPDATE shidduchim SET shadchan_id = (SELECT id FROM shadchanim WHERE name = 'Acme') WHERE id = 1",
    ],
    [
      "writable CTE with INSERT",
      "WITH d AS (DELETE FROM old_shidduchim RETURNING *) INSERT INTO archive SELECT * FROM d",
    ],
  ])("allows %s", (_label, sql) => {
    expect(validateWrite(sql)).toBeNull();
  });

  it.each([
    ["standalone SELECT", "SELECT * FROM shidduchim"],
    ["DROP TABLE", "DROP TABLE shidduchim"],
    ["CREATE TABLE", "CREATE TABLE evil (id int)"],
    ["TRUNCATE", "TRUNCATE shidduchim"],
    ["SET", "SET LOCAL role = 'postgres'"],
    [
      "multi-statement (DELETE; DROP)",
      "DELETE FROM shidduchim; DROP TABLE shidduchim",
    ],
    [
      "multi-statement (DELETE; SET)",
      "DELETE FROM shidduchim; SET LOCAL role = 'postgres'",
    ],
    ["unparseable SQL", "NOT VALID SQL %%%"],
  ])("rejects %s", (_label, sql) => {
    expect(validateWrite(sql)).not.toBeNull();
  });
});
