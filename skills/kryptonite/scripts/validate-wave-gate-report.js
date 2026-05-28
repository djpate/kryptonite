import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { positionals } = parseArgs({ allowPositionals: true });
const reportFile = positionals[0];

if (!reportFile) {
  console.error("Usage: node validate-wave-gate-report.js <path-to-report.json>");
  process.exit(2);
}

const scriptsDir = path.dirname(new URL(import.meta.url).pathname);
const refsDir = path.join(scriptsDir, "..", "references");
const schema = JSON.parse(fs.readFileSync(path.join(refsDir, "wave-gate-report-schema.json"), "utf-8"));
const report = JSON.parse(fs.readFileSync(reportFile, "utf-8"));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const valid = validate(report);

if (!valid) {
  console.log(JSON.stringify({ valid: false, errors: validate.errors }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ valid: true }, null, 2));
process.exit(0);
