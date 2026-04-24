// One-time Google OAuth setup — run once to store tokens in Keychain.
// Usage: node --env-file=.env --import=tsx agent/src/auth/setup.ts

import { google } from 'googleapis';
import { storeTokens } from './google.js';
import { createInterface } from 'readline';

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:41245/api/auth/google/callback';

const oauth2Client = new google.auth.OAuth2(
  clientId,
  clientSecret,
  redirectUri,
);

const url = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/drive',
  ],
});

console.log('\n1. Open this URL in your browser:\n');
console.log(url);
console.log('\n2. Authorize Cortex, then copy the "code" parameter from the redirect URL.');
console.log('   (The page will fail to load — that\'s fine. Copy the code from the URL bar.)');
console.log('   It looks like: http://localhost:41245/?code=4/0AXXXXXX...&scope=...\n');

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question('Paste the code here: ', async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(decodeURIComponent(code.trim()));
    if (!tokens.access_token || !tokens.refresh_token) {
      console.error('Error: missing tokens in response', tokens);
      process.exit(1);
    }
    await storeTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date ?? undefined,
    });
    console.log('\n✓ Tokens stored in macOS Keychain (com.cortex.daemon)');
    console.log('  The daemon can now access Gmail and Drive.');
  } catch (err) {
    console.error('Error exchanging code:', err);
    process.exit(1);
  }
});
