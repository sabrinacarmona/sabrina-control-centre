const fs = require('fs');
const { google } = require('googleapis');

module.exports = function ({ getGoogleApiConfig, getOAuth2Client, SCOPES, TOKEN_PATH }) {
    const router = require('express').Router();

    // Generate Auth URL
    router.get('/auth/url', (req, res) => {
        try {
            const { client_secret, client_id, redirect_uris } = getGoogleApiConfig();
            const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

            const authUrl = oAuth2Client.generateAuthUrl({
                access_type: 'offline',
                prompt: 'consent',
                scope: SCOPES,
            });
            res.json({ url: authUrl });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Exchange Code for Token
    router.post('/auth/token', async (req, res) => {
        const { code } = req.body;
        try {
            const { client_secret, client_id, redirect_uris } = getGoogleApiConfig();
            const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

            const { tokens } = await oAuth2Client.getToken(code);
            oAuth2Client.setCredentials(tokens);
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // OAuth redirect callback (mounted at root, not /api)
    router.oauthCallback = async (req, res) => {
        const code = req.query.code;
        if (!code) {
            return res.send(`<h2>Authentication Failed</h2><p>No code returned.</p><a href="/">Return</a>`);
        }
        try {
            const { client_secret, client_id, redirect_uris } = getGoogleApiConfig();
            const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

            const { tokens } = await oAuth2Client.getToken(code);
            oAuth2Client.setCredentials(tokens);
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
            console.log('Token stored via callback redirect');

            res.redirect('/');
        } catch (err) {
            console.error('Error in oauth2callback', err);
            res.send(`<h2>Authentication Failed</h2><p>${err.message}</p><a href="/">Return</a>`);
        }
    };

    return router;
};
