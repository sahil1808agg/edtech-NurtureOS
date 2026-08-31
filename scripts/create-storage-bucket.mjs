/**
 * Creates a private Supabase Storage bucket, idempotently.
 *
 *   node scripts/create-storage-bucket.mjs reports
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const bucketId = process.argv[2];
if (!bucketId) {
  console.error("Usage: node scripts/create-storage-bucket.mjs <bucket-id>");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "")]),
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: existing } = await admin.storage.getBucket(bucketId);
if (existing) {
  console.log(`PASS  bucket "${bucketId}" already exists`);
  process.exit(0);
}

const { error } = await admin.storage.createBucket(bucketId, {
  public: false,
  allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png"],
});

if (error) {
  console.error(`FAIL  createBucket("${bucketId}"):`, error.message);
  process.exit(1);
}

console.log(`PASS  created private bucket "${bucketId}"`);
