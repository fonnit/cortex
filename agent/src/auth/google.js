"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.storeTokens = storeTokens;
exports.loadTokens = loadTokens;
exports.getGoogleOAuthClient = getGoogleOAuthClient;
exports.runInitialAuthFlow = runInitialAuthFlow;
const googleapis_1 = require("googleapis");
const keytar_1 = __importDefault(require("keytar"));
const KEYCHAIN_SERVICE = 'com.cortex.daemon';
const KEYCHAIN_ACCOUNT_ACCESS = 'google_access_token';
const KEYCHAIN_ACCOUNT_REFRESH = 'google_refresh_token';
async function storeTokens(tokens) {
    await keytar_1.default.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_ACCESS, tokens.access_token);
    await keytar_1.default.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_REFRESH, tokens.refresh_token);
}
async function loadTokens() {
    const access_token = await keytar_1.default.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_ACCESS);
    const refresh_token = await keytar_1.default.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_REFRESH);
    if (!access_token || !refresh_token)
        return null;
    return { access_token, refresh_token };
}
async function getGoogleOAuthClient() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required');
    }
    const oauth2Client = new googleapis_1.google.auth.OAuth2(clientId, clientSecret, 'urn:ietf:wg:oauth:2.0:oob');
    const tokens = await loadTokens();
    if (!tokens) {
        throw new Error('No Google OAuth tokens in Keychain. Run the one-time auth flow first.\n' +
            'Generate auth URL with: oauth2Client.generateAuthUrl({ access_type: "offline", scope: [...] })');
    }
    oauth2Client.setCredentials(tokens);
    // Auto-persist refreshed tokens
    oauth2Client.on('tokens', async (newTokens) => {
        if (newTokens.access_token) {
            await keytar_1.default.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_ACCESS, newTokens.access_token);
        }
    });
    return oauth2Client;
}
// One-time initial auth helper — call manually, not from daemon loop
async function runInitialAuthFlow(clientId, clientSecret) {
    const oauth2Client = new googleapis_1.google.auth.OAuth2(clientId, clientSecret, 'urn:ietf:wg:oauth:2.0:oob');
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
