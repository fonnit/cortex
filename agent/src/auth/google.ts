import { google } from 'googleapis';
import keytar from 'keytar';

const KEYCHAIN_SERVICE = 'com.cortex.daemon';
const KEYCHAIN_ACCOUNT_ACCESS = 'google_access_token';
const KEYCHAIN_ACCOUNT_REFRESH = 'google_refresh_token';

export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expiry_date?: number;
}

export async function storeTokens(tokens: GoogleTokens): Promise<void> {
  await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_ACCESS, tokens.access_token);
  await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_REFRESH, tokens.refresh_token);
}

export async function loadTokens(): Promise<GoogleTokens | null> {
  const access_token = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_ACCESS);
  const refresh_token = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_REFRESH);
  if (!access_token || !refresh_token) return null;
  return { access_token, refresh_token };
}

export async function getGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required');
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'http://localhost:41245/api/auth/google/callback', // desktop/daemon flow
  );

  const tokens = await loadTokens();
  if (!tokens) {
    throw new Error(
      'No Google OAuth tokens in Keychain. Run the one-time auth flow first.\n' +
      'Generate auth URL with: oauth2Client.generateAuthUrl({ access_type: "offline", scope: [...] })',
    );
  }

  oauth2Client.setCredentials(tokens);

  // Auto-persist refreshed tokens
  oauth2Client.on('tokens', async (newTokens) => {
    if (newTokens.access_token) {
      await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_ACCESS, newTokens.access_token);
    }
  });

  return oauth2Client;
}

// One-time initial auth helper — call manually, not from daemon loop
export async function runInitialAuthFlow(clientId: string, clientSecret: string): Promise<void> {
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:41245/api/auth/google/callback');
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/drive',
    ],
  });
  console.log('Visit this URL to authorise Cortex:\n', url);
  // After user pastes code: call oauth2Client.getToken(code) then storeTokens()
}
