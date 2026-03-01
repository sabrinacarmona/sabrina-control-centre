const { google } = require('googleapis');

module.exports = function ({ getOAuth2Client, apiCache }) {
    const router = require('express').Router();

    router.get('/calendar', async (req, res) => {
        const context = req.query.context || 'both';
        const cacheKey = `calendarData_${context}`;
        const cachedData = apiCache.get(cacheKey);
        if (cachedData) {
            res.setHeader('X-Cache', 'HIT');
            return res.json(cachedData);
        }

        try {
            const auth = await getOAuth2Client();
            const calendar = google.calendar({ version: 'v3', auth });

            const timeMin = new Date();
            const timeMax = new Date();
            timeMax.setDate(timeMax.getDate() + 30);

            let calendarIds = ['primary'];

            if (context === 'professional') {
                calendarIds = process.env.PROFESSIONAL_CALENDAR_IDS ? process.env.PROFESSIONAL_CALENDAR_IDS.split(',') : [];
            } else if (context === 'personal') {
                calendarIds = process.env.PERSONAL_CALENDAR_IDS ? process.env.PERSONAL_CALENDAR_IDS.split(',') : [];
            } else {
                const profCals = process.env.PROFESSIONAL_CALENDAR_IDS ? process.env.PROFESSIONAL_CALENDAR_IDS.split(',') : [];
                const persCals = process.env.PERSONAL_CALENDAR_IDS ? process.env.PERSONAL_CALENDAR_IDS.split(',') : [];
                calendarIds = Array.from(new Set([...profCals, ...persCals]));
                if (calendarIds.length === 0) calendarIds = ['primary'];
            }

            const eventsPromises = calendarIds.map(async (calendarId) => {
                try {
                    const response = await calendar.events.list({
                        calendarId: calendarId.trim(),
                        timeMin: timeMin.toISOString(),
                        timeMax: timeMax.toISOString(),
                        maxResults: 15,
                        singleEvents: true,
                        orderBy: 'startTime',
                    });
                    return response.data.items;
                } catch (e) {
                    console.error(`Failed to fetch from calendar ${calendarId}`, e.message);
                    return [];
                }
            });

            const allItems = (await Promise.all(eventsPromises)).flat();

            allItems.sort((a, b) => {
                const dateA = new Date(a.start.dateTime || a.start.date);
                const dateB = new Date(b.start.dateTime || b.start.date);
                return dateA - dateB;
            });

            const events = allItems.slice(0, 15).map(event => ({
                id: event.id,
                summary: event.summary,
                start: event.start.dateTime || event.start.date,
                end: event.end.dateTime || event.end.date,
            }));

            res.setHeader('X-Cache', 'MISS');
            apiCache.set(cacheKey, events);
            res.json(events);
        } catch (err) {
            res.status(500).json({ error: err.message, requiresAuth: err.message.includes('authenticate') || err.message.includes('credentials.json') || err.message.includes('refresh token') });
        }
    });

    return router;
};
