const { google } = require('googleapis');

module.exports = function ({ getOAuth2Client, apiCache }) {
    const router = require('express').Router();

    router.get('/inbox', async (req, res) => {
        const cacheKey = 'inboxData';
        const cachedData = apiCache.get(cacheKey);
        if (cachedData) {
            res.setHeader('X-Cache', 'HIT');
            return res.json(cachedData);
        }

        try {
            const auth = await getOAuth2Client();
            const gmail = google.gmail({ version: 'v1', auth });

            const response = await gmail.users.messages.list({
                userId: 'me',
                q: 'in:inbox',
                maxResults: 5,
            });

            if (!response.data.messages) {
                apiCache.set(cacheKey, [], 30);
                return res.json([]);
            }

            const messages = await Promise.all(response.data.messages.map(async (msg) => {
                const detail = await gmail.users.messages.get({
                    userId: 'me',
                    id: msg.id,
                    format: 'metadata',
                    metadataHeaders: ['Subject', 'From', 'Date'],
                });
                const headers = detail.data.payload.headers;
                const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
                const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
                return { id: msg.id, snippet: detail.data.snippet, subject, from };
            }));

            res.setHeader('X-Cache', 'MISS');
            apiCache.set(cacheKey, messages, 30);
            res.json(messages);
        } catch (err) {
            res.status(500).json({ error: err.message, requiresAuth: err.message.includes('authenticate') || err.message.includes('credentials.json') || err.message.includes('refresh token') });
        }
    });

    return router;
};
