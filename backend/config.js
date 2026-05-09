"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// Map Next.js or differently named vars to what the backend expects
if (!process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
}
if (!process.env.SUPABASE_SERVICE_KEY) {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  } else if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    process.env.SUPABASE_SERVICE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  }
}

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "ENCRYPTION_KEY"];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  throw new Error(`Missing required env vars: ${missing.join(", ")}`);
}

const config = Object.freeze({
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY,
  encryptionKey: process.env.ENCRYPTION_KEY,
  port: process.env.PORT || 8000,
  dailyCapUSD: parseFloat(process.env.DAILY_CAP_USD || "5.0"),
  nodeEnv: process.env.NODE_ENV || "development",
});

console.log("✅ Config validated");

module.exports = config;
