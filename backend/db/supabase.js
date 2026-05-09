const { createClient } = require("@supabase/supabase-js");
const config = require("../config");

const supabase = createClient(config.supabaseUrl, config.supabaseKey);

console.log("✅ Supabase client initialized");

module.exports = supabase;
