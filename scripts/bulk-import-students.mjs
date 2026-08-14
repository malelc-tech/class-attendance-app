import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { randomBytes } from "crypto";

function loadEnvLocal() {
  const path = ".env.local";
  if (!existsSync(path)) {
    console.error("Could not find .env.local in the current folder.");
    console.error("Run this script from your project root: node scripts/bulk-import-students.mjs students.csv");
    process.exit(1);
  }
  const lines = readFileSync(path, "utf-8").split("\n");
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

const env = loadEnvLocal();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const inputFile = process.argv[2];
if (!inputFile) {
  console.error("Usage: node scripts/bulk-import-students.mjs students.csv");
  process.exit(1);
}
if (!existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}`);
  process.exit(1);
}

const rows = readFileSync(inputFile, "utf-8")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [fullName, studentId] = line.split(",").map((s) => s?.trim());
    return { fullName, studentId };
  })
  .filter((r) => r.fullName && r.studentId);

console.log(`Found ${rows.length} students in ${inputFile}\n`);

function emailFromStudentId(studentId) {
  const slug = studentId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}@students.local`;
}

function generatePassword() {
  return randomBytes(6).toString("hex").slice(0, 8);
}

const results = [];
let created = 0;
let skipped = 0;
let failed = 0;

for (const { fullName, studentId } of rows) {
  const email = emailFromStudentId(studentId);
  const password = generatePassword();

  const { data: userData, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: "student" },
  });

  if (createError) {
    if (createError.message?.toLowerCase().includes("already registered")) {
      console.log(`SKIP (already exists): ${fullName} <${email}>`);
      results.push({ fullName, studentId, email, password: "(already existed)", status: "skipped" });
      skipped++;
    } else {
      console.log(`FAILED: ${fullName} <${email}> — ${createError.message}`);
      results.push({ fullName, studentId, email, password: "", status: `failed: ${createError.message}` });
      failed++;
    }
    continue;
  }

  const { error: updateError } = await supabase
    .from("users")
    .update({ full_name: fullName, student_id: studentId })
    .eq("id", userData.user.id);

  if (updateError) {
    console.log(`Created auth user but failed to set student_id for ${fullName}: ${updateError.message}`);
  }

  console.log(`OK: ${fullName} <${email}>`);
  results.push({ fullName, studentId, email, password, status: "created" });
  created++;
}

const outputLines = [
  "Full Name,Student ID,Email,Password,Status",
  ...results.map(
    (r) =>
      `"${r.fullName}","${r.studentId}","${r.email}","${r.password}","${r.status}"`
  ),
];
writeFileSync("students_credentials.csv", outputLines.join("\n"));

console.log("\n--- Summary ---");
console.log(`Created: ${created}`);
console.log(`Skipped (already existed): ${skipped}`);
console.log(`Failed: ${failed}`);
console.log(`\nLogin details written to students_credentials.csv`);