// Fills js/config.js in the built site from the SUPABASE_URL / SUPABASE_KEY repository secrets.
// Only a publishable key is accepted, so a secret key can never be shipped to browsers by mistake.
'use strict';
const fs = require('fs');

const file = process.argv[2];
const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const key = (process.env.SUPABASE_KEY || '').trim();

if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)) {
  throw new Error('SUPABASE_URL secret is missing or not a https://<project>.supabase.co address');
}
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
  throw new Error('SUPABASE_KEY secret must be the publishable key (sb_publishable_...)');
}

let src = fs.readFileSync(file, 'utf8');
src = src.replace("supabaseUrl: ''", `supabaseUrl: '${url}'`).replace("supabaseKey: ''", `supabaseKey: '${key}'`);
if (!src.includes(url) || !src.includes(key)) throw new Error('Could not find the empty settings in ' + file);
fs.writeFileSync(file, src);
console.log('Database settings written to', file);
