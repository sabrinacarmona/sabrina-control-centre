const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
];
const TOKEN_PATH = process.env.RAILWAY_ENVIRONMENT
    ? '/data/token.json'
    : path.join(__dirname, '..', 'token.json');

function getGoogleApiConfig() {
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        return {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uris: [process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback'],
        };
    }
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        return credentials.installed || credentials.web;
    }
    throw new Error('GOOGLE_CREDENTIALS_JSON environment variable is not set.');
}

async function getOAuth2Client() {
    const { client_secret, client_id, redirect_uris } = getGoogleApiConfig();
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    if (process.env.GOOGLE_TOKEN_JSON) {
        oAuth2Client.setCredentials(JSON.parse(process.env.GOOGLE_TOKEN_JSON));
        return oAuth2Client;
    }
    if (fs.existsSync(TOKEN_PATH)) {
        const token = fs.readFileSync(TOKEN_PATH);
        oAuth2Client.setCredentials(JSON.parse(token));
        return oAuth2Client;
    }
    throw new Error('Not authenticated. Please authorize the app.');
}

module.exports = { SCOPES, TOKEN_PATH, getGoogleApiConfig, getOAuth2Client };
