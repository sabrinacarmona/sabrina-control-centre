const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

// --- Dependency Injection ---
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const NodeCache = require('node-cache');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const { z } = require('zod');
const { TripsResponseSchema } = require('./schemas/zodSchemas');
const { deduplicateTrips } = require('./utils/deduplication');
const http = require('http');
const WebSocket = require('ws');

// --- Initialization: Database Path (for backup cron) ---
const DB_PATH = path.resolve(__dirname, (process.env.DATABASE_URL || 'file:./database.db').replace('file:', ''));

// --- Initialization: Cache ---
// TTL is 300 seconds (5 minutes)
const apiCache = new NodeCache({ stdTTL: 300 });

// --- Initialization: Express & AI ---
let ai = null;
if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} else {
    console.warn("⚠️  GEMINI_API_KEY not found in environment. Auto-Scheduling AI features will be disabled.");
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://bernardo-castilho.github.io"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https:"],
        },
    }
}));
app.use(cors({ origin: ['http://localhost:3000', process.env.RAILWAY_URL || ''] }));
app.use(express.json());

// --- Access Control Gate ---
// Set AUTH_PASSWORD in .env to protect all API routes.
// When set, clients must send `Authorization: Bearer <password>` on every request.
if (process.env.AUTH_PASSWORD) {
    app.post('/api/auth/login', (req, res) => {
        if (req.body.password === process.env.AUTH_PASSWORD) {
            res.json({ success: true });
        } else {
            res.status(401).json({ error: 'Invalid password' });
        }
    });

    app.use('/api', (req, res, next) => {
        if (req.path === '/auth/login') return next();
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token === process.env.AUTH_PASSWORD) return next();
        res.status(401).json({ error: 'Unauthorized' });
    });
}

// Serve static frontend files
app.use(express.static(path.join(__dirname)));

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'];
const TOKEN_PATH = process.env.RAILWAY_ENVIRONMENT ? '/data/token.json' : path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

// Seed default rituals if table is empty
(async () => {
    try {
        const count = await prisma.ritual.count();
        if (count === 0) {
            const today = new Date().toDateString();
            await prisma.ritual.createMany({
                data: [
                    { id: "r1", title: "Drink a large glass of water", completed: 0, lastResetDate: today },
                    { id: "r2", title: "10 minute stretching session", completed: 0, lastResetDate: today },
                    { id: "r3", title: "Review Zenith Priority goals", completed: 0, lastResetDate: today }
                ]
            });
        }
    } catch (e) {
        console.error("Failed to seed default rituals:", e);
    }
})();

function getGoogleApiConfig() {
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        return {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uris: [process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback']
        };
    }
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        return credentials.installed || credentials.web;
    }
    throw new Error('GOOGLE_CREDENTIALS_JSON environment variable is not set.');
}

// Helper wrapper to get OAuth2 Client
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

// Generate Auth URL
app.get('/api/auth/url', (req, res) => {
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
app.post('/api/auth/token', async (req, res) => {
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

// Handle OAuth redirect from Google
app.get('/oauth2callback', async (req, res) => {
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

        // Redirect back to dashboard on success
        res.redirect('/');
    } catch (err) {
        console.error('Error in oauth2callback', err);
        res.send(`<h2>Authentication Failed</h2><p>${err.message}</p><a href="/">Return</a>`);
    }
});

// --- Tasks Endpoints (SQLite/Prisma) ---
app.get('/api/tasks', async (req, res) => {
    const context = req.query.context || 'both';
    try {
        const tasks = context === 'both'
            ? await prisma.task.findMany()
            : await prisma.task.findMany({ where: { contextMode: { in: [context, 'both'] } } });
        res.json(tasks.map(t => ({ ...t, context_mode: t.contextMode, source_reference: t.sourceReference })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tasks', async (req, res) => {
    const tasks = req.body;
    const context = req.query.context || 'both';

    try {
        await prisma.$transaction(async (tx) => {
            if (context === 'both') {
                await tx.task.deleteMany();
            } else {
                await tx.task.deleteMany({ where: { contextMode: context } });
            }
            if (tasks.length > 0) {
                await tx.task.createMany({
                    data: tasks.map(t => ({
                        id: t.id,
                        title: t.title,
                        status: t.status,
                        contextMode: t.context_mode || context,
                        sourceReference: t.source_reference
                    }))
                });
            }
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Quick Notes Endpoints (SQLite/Prisma) ---
app.get('/api/notes', async (req, res) => {
    const context = req.query.context || 'both';
    try {
        let note = await prisma.note.findFirst({ where: { contextMode: context } });
        if (!note) {
            note = await prisma.note.create({ data: { content: "", contextMode: context } });
        }
        res.json(note);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/notes', async (req, res) => {
    const { content } = req.body;
    const context = req.query.context || 'both';
    try {
        const note = await prisma.note.findFirst({ where: { contextMode: context } });
        if (note) {
            await prisma.note.update({ where: { id: note.id }, data: { content: content || "" } });
        } else {
            await prisma.note.create({ data: { content: content || "", contextMode: context } });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Daily Rituals Endpoints (SQLite/Prisma) ---
app.get('/api/rituals', async (req, res) => {
    const today = new Date().toDateString();
    const context = req.query.context || 'both';

    try {
        let rituals = context === 'both'
            ? await prisma.ritual.findMany()
            : await prisma.ritual.findMany({ where: { contextMode: { in: [context, 'both'] } } });

        if (rituals.length > 0 && rituals[0].lastResetDate !== today) {
            await prisma.ritual.updateMany({ data: { completed: 0, lastResetDate: today } });
            rituals = context === 'both'
                ? await prisma.ritual.findMany()
                : await prisma.ritual.findMany({ where: { contextMode: { in: [context, 'both'] } } });
        }

        res.json(rituals.map(r => ({ ...r, completed: r.completed === 1, context_mode: r.contextMode })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/rituals/:id', async (req, res) => {
    const { id } = req.params;
    const { completed } = req.body;
    try {
        await prisma.ritual.update({ where: { id }, data: { completed: completed ? 1 : 0 } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/rituals', express.json(), async (req, res) => {
    const { title, context_mode = 'both' } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const id = Date.now().toString();
    const today = new Date().toDateString();

    try {
        await prisma.ritual.create({
            data: { id, title, completed: 0, lastResetDate: today, contextMode: context_mode }
        });
        res.json({ id, title, completed: false, lastResetDate: today, context_mode });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/rituals/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.ritual.delete({ where: { id } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Calendar Endpoint (Cached) ---
app.get('/api/calendar', async (req, res) => {
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

        // Next 30 days window
        const timeMin = new Date();
        const timeMax = new Date();
        timeMax.setDate(timeMax.getDate() + 30);

        let calendarIds = ['primary']; // Default fallback

        if (context === 'professional') {
            calendarIds = process.env.PROFESSIONAL_CALENDAR_IDS ? process.env.PROFESSIONAL_CALENDAR_IDS.split(',') : [];
        } else if (context === 'personal') {
            calendarIds = process.env.PERSONAL_CALENDAR_IDS ? process.env.PERSONAL_CALENDAR_IDS.split(',') : [];
        } else {
            // Context 'both' -> Combine both
            const profCals = process.env.PROFESSIONAL_CALENDAR_IDS ? process.env.PROFESSIONAL_CALENDAR_IDS.split(',') : [];
            const persCals = process.env.PERSONAL_CALENDAR_IDS ? process.env.PERSONAL_CALENDAR_IDS.split(',') : [];
            calendarIds = Array.from(new Set([...profCals, ...persCals]));
            // Only fallback to primary if 'both' is requested and absolutely nothing is configured
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

        // Sort the merged items by startTime and filter empty
        allItems.sort((a, b) => {
            const dateA = new Date(a.start.dateTime || a.start.date);
            const dateB = new Date(b.start.dateTime || b.start.date);
            return dateA - dateB;
        });

        const events = allItems.slice(0, 15).map(event => ({
            id: event.id,
            summary: event.summary,
            start: event.start.dateTime || event.start.date,
            end: event.end.dateTime || event.end.date
        }));

        res.setHeader('X-Cache', 'MISS');
        apiCache.set(cacheKey, events);
        res.json(events);
    } catch (err) {
        res.status(500).json({ error: err.message, requiresAuth: err.message.includes('authenticate') || err.message.includes('credentials.json') || err.message.includes('refresh token') });
    }
});

// --- Inbox Endpoint (Short-Lived 30s Cache for Rate Limiting Mitigation) ---
app.get('/api/inbox', async (req, res) => {
    const cacheKey = 'inboxData';
    const cachedData = apiCache.get(cacheKey);
    if (cachedData) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(cachedData);
    }

    try {
        const auth = await getOAuth2Client();
        const gmail = google.gmail({ version: 'v1', auth });

        // Get actionable messages (anything in the inbox)
        const response = await gmail.users.messages.list({
            userId: 'me',
            q: 'in:inbox',
            maxResults: 5
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
                metadataHeaders: ['Subject', 'From', 'Date']
            });
            const headers = detail.data.payload.headers;
            const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
            const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
            return { id: msg.id, snippet: detail.data.snippet, subject, from };
        }));

        res.setHeader('X-Cache', 'MISS');
        apiCache.set(cacheKey, messages, 30); // 30 second TTL
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message, requiresAuth: err.message.includes('authenticate') || err.message.includes('credentials.json') || err.message.includes('refresh token') });
    }
});

const activeSyncs = new Set();

// --- Background Sync for Trips ---
const saveGroupedTripsToDb = async (context, dataArray) => {
    const now = new Date().toISOString();

    await prisma.$transaction(async (tx) => {
        await tx.trip.deleteMany({ where: { contextMode: context } });

        for (const t of dataArray) {
            await tx.trip.create({
                data: {
                    contextMode: context,
                    tripName: t.Trip || t.TripName || "Unknown Trip",
                    startDate: t.StartDate || "",
                    endDate: t.EndDate || null,
                    lastUpdated: now,
                    components: {
                        create: (t.Components || []).map(c => ({
                            type: c.Type || "Unknown",
                            name: c.Name || "Unknown",
                            date: c.Date || null,
                            time: c.Time || null,
                            airline: c.Airline || null,
                            flightNumber: c.FlightNumber || null,
                            confirmation: c.Confirmation || null,
                            address: c.Address || null,
                        }))
                    }
                }
            });
        }
    });
};

const syncTripsForContext = async (context) => {
    if (activeSyncs.has(context)) {
        console.log(`[Trip Sync] Sync already in progress for ${context}, skipping duplicate request.`);
        return;
    }
    activeSyncs.add(context);
    console.log(`[Trip Sync] Starting sync for context: ${context}`);

    // Broadcast to connected WebSocket clients
    if (typeof broadcastEvent === 'function') {
        broadcastEvent('TRIP_SYNC_START', { context });
    }

    try {
        const auth = await getOAuth2Client();
        if (!auth) {
            console.log(`[Trip Sync] Auth missing, skipping.`);
            activeSyncs.delete(context);
            return;
        }

        const gmail = google.gmail({ version: 'v1', auth });
        const calendar = google.calendar({ version: 'v3', auth });

        // 1. Fetch Gmail Data
        let emailData = [];
        try {
            const query = 'in:inbox (subject:flight OR subject:hotel OR subject:reservation OR subject:booking OR subject:train OR subject:itinerary) newer_than:180d';
            const response = await gmail.users.messages.list({
                userId: 'me',
                q: query,
                maxResults: 50
            });
            if (response.data.messages) {
                const msgs = await Promise.all(response.data.messages.map(async (m) => {
                    const detail = await gmail.users.messages.get({
                        userId: 'me',
                        id: m.id,
                        format: 'metadata',
                        metadataHeaders: ['Subject', 'Date']
                    });
                    const headers = detail.data.payload.headers;
                    const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
                    const date = headers.find(h => h.name === 'Date')?.value || 'Unknown Date';
                    return { source: 'gmail', subject, date, snippet: detail.data.snippet };
                }));
                emailData = msgs;
            }
        } catch (e) { console.error('[Trip Sync] Gmail fetch failed', e.message); }

        // 2. Fetch Calendar Data
        let calendarData = [];
        try {
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
            calendarIds = calendarIds.map(id => id.trim());

            const calListResponse = await calendar.calendarList.list();
            let targetCals = calListResponse.data.items;
            if (calendarIds[0] !== 'primary') {
                targetCals = targetCals.filter(cal => calendarIds.includes(cal.id));
            }

            const calPromises = targetCals.map(cal => {
                return calendar.events.list({
                    calendarId: cal.id,
                    timeMin: new Date().toISOString(),
                    timeMax: new Date(new Date().setDate(new Date().getDate() + 90)).toISOString(),
                    maxResults: 30,
                    singleEvents: true,
                    orderBy: 'startTime',
                }).then(response => {
                    if (!response.data.items) return [];
                    const travelEvents = response.data.items.filter(e => {
                        const text = (e.summary + " " + (e.description || "")).toLowerCase();
                        return ['flight', 'train', 'hotel', 'travelperk', 'tripit', 'rental', 'reservation'].some(kw => text.includes(kw));
                    });
                    return travelEvents.map(e => ({
                        source: 'calendar',
                        subject: e.summary,
                        start: e.start.dateTime || e.start.date,
                        end: e.end.dateTime || e.end.date,
                        description: e.description || ''
                    }));
                }).catch(err => { console.error(`[Trip Sync] Calendar ${cal.summary} failed`, err.message); return []; });
            });
            calendarData = (await Promise.all(calPromises)).flat();
        } catch (e) { console.error('[Trip Sync] Calendar fetch failed', e.message); }

        const combinedData = [...emailData, ...calendarData];
        if (combinedData.length === 0) {
            console.log(`[Trip Sync] No travel data found for ${context}. Saving empty state.`);
            saveGroupedTripsToDb(context, []);
            return;
        }

        // 3. Process via Gemini
        if (!ai) {
            console.log("[Trip Sync] Gemini API absent, cannot group trips.");
            saveGroupedTripsToDb(context, []);
            return;
        }

        const prompt = `
You are a highly intelligent travel grouping engine.
I am providing you with unstructured data representing a user's upcoming travel from both their Calendar and their Gmail Inbox.
Your job is to:
1. Identify distinct "Trips" (e.g., a trip to San Francisco, a trip to London).
2. Group all related flights, hotels, and train bookings under their respective parent Trips.
3. AGGRESSIVELY DEDUPLICATE: If a flight appears in both the calendar and the inbox, merge it into a SINGLE component.
4. Format the output strictly as the following JSON schema. No extra markdown, no code blocks, just raw JSON.
5. ZERO MERGING RULE: You MUST output each distinct primary city/location as its own separate Trip object. NEVER combine multiple distinct cities (e.g., "San Francisco" and "Los Angeles" or "Helsinki" and "London") into a single Trip, even if they occur consecutively. We handle multi-city trip merging independently. A single trip in your JSON must represent ONE cohesive destination.

Schema to follow EXACTLY:
[
  {
    "TripName": "City/Location Name",
    "StartDate": "YYYY-MM-DD",
    "EndDate": "YYYY-MM-DD",
    "Components": [
      {
        "Type": "Flight | Hotel | Train | Other",
        "Name": "Short description (e.g. BA285 to SFO)",
        "Date": "YYYY-MM-DD",
        "Time": "HH:mm or null",
        "Confirmation": "Found code or N/A"
      }
    ]
  }
]

Raw Data to Process:
${JSON.stringify(combinedData)}
`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        const responseText = response.text.replace(/```json/gi, '').replace(/```/g, '').trim();
        const rawParsedTrips = JSON.parse(responseText);

        // --- Phase 1: Zod Schema Validation ---
        const parsedTrips = TripsResponseSchema.parse(rawParsedTrips);

        // --- Hotfix 4.9.2: JS-Level 14-Day Deduplication (now in utils) ---
        let groupedTrips = deduplicateTrips(parsedTrips);

        // 4. Save to Database
        saveGroupedTripsToDb(context, groupedTrips);

        console.log(`[Trip Sync] Successfully synced trips for ${context}`);
        if (typeof broadcastEvent === 'function') {
            broadcastEvent('TRIP_SYNC_COMPLETE', { context });
        }
    } catch (err) {
        console.error(`[Trip Sync] Error syncing context ${context}:`, err);
        if (typeof broadcastEvent === 'function') {
            broadcastEvent('TRIP_SYNC_ERROR', { context, error: err.message });
        }
    } finally {
        activeSyncs.delete(context);
    }
};

// --- Webhooks (Replaces Polling) ---
// Note: Requires configuring Google Cloud Pub/Sub and granting Gmail API publish rights.

// 1. Automatically renew the Push subscription watch every 24 hours
cron.schedule('0 2 * * *', async () => {
    console.log('[Cron] Renewing Gmail Push Notification Watch Subscription...');
    try {
        const auth = await getOAuth2Client();
        if (!auth) return;
        const gmail = google.gmail({ version: 'v1', auth });

        await gmail.users.watch({
            userId: 'me',
            requestBody: {
                labelIds: ['INBOX'],
                labelFilterBehavior: 'INCLUDE',
                topicName: `projects/${process.env.GCP_PROJECT_ID}/topics/${process.env.GCP_PUBSUB_TOPIC || 'gmail-inbox-updates'}`
            }
        });
        console.log('[Cron] Successfully renewed Gmail watch subscription.');
    } catch (err) {
        console.error('[Cron] Failed to renew Gmail watch subscription:', err.message);
    }
});
app.post('/api/webhooks/gmail', async (req, res) => {
    try {
        const message = req.body.message;
        if (!message || !message.data) {
            return res.status(400).send('Bad Request: Invalid Pub/Sub message format');
        }

        // The data is base64 encoded by Pub/Sub
        const decodedData = Buffer.from(message.data, 'base64').toString('utf-8');
        const payload = JSON.parse(decodedData);

        console.log(`[Webhook] Received Gmail push notification for user: ${payload.emailAddress}`);

        // Acknowledge receipt immediately so Google doesn't retry
        res.status(200).send('OK');

        // Kick off sync asynchronously
        const auth = await getOAuth2Client();
        if (auth) {
            // In a real app, you might look at payload.historyId to fetch only changes
            // For now, we perform our standard structured syncs.
            syncTripsForContext('professional');
            syncTripsForContext('personal');
        }
    } catch (err) {
        console.error('[Webhook] Error processing Gmail notification:', err);
        // Return 500 to trigger Google Cloud Pub/Sub retry backoff if there's a serious failure
        res.status(500).send('Internal Server Error');
    }
});

// --- Disaster Recovery Protocol (Automated Backup) ---
const sendDatabaseBackup = async (triggerSource = 'Cron') => {
    console.log(`[Backup] Starting database backup. Trigger: ${triggerSource}`);
    try {
        const auth = await getOAuth2Client();
        if (!auth) {
            console.log(`[Backup] Auth missing, skipping backup.`);
            return false;
        }

        if (!fs.existsSync(DB_PATH)) {
            console.log(`[Backup] Database file not found at ${DB_PATH}. Skipping.`);
            return false;
        }

        const gmail = google.gmail({ version: 'v1', auth });
        // Get user's own email address
        const profile = await google.gmail({ version: 'v1', auth }).users.getProfile({ userId: 'me' });
        const userEmail = profile.data.emailAddress;

        // Read the database
        const dbBuffer = fs.readFileSync(DB_PATH);
        const dateStr = new Date().toISOString().split('T')[0];

        // Ensure Nodemailer is using the auth client's current access token
        const tokenResp = await auth.getAccessToken();
        const token = tokenResp ? tokenResp.token : null;
        if (!token) throw new Error("Could not retrieve access token for Nodemailer.");

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                type: 'OAuth2',
                user: userEmail,
                clientId: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                accessToken: token,
                refreshToken: auth.credentials.refresh_token,
            }
        });

        await transporter.sendMail({
            from: `"SabrinaOS Auto-Pilot" <${userEmail}>`,
            to: userEmail,
            subject: `🛡️ SabrinaOS Daily DB Backup (${dateStr})`,
            text: `Attached is your latest SabrinaOS SQLite database backup (database_backup_${dateStr}.db). Triggered by: ${triggerSource}.\n\nKeep this safe!`,
            attachments: [
                {
                    filename: `database_backup_${dateStr}.db`,
                    content: dbBuffer,
                    contentType: 'application/x-sqlite3'
                }
            ]
        });

        console.log(`[Backup] Successfully emailed database to ${userEmail} via nodemailer`);
        return true;
    } catch (err) {
        console.error(`[Backup] Failed to send database backup:`, err);
        return false;
    }
};

// Execute at 3:00 AM every night
cron.schedule('0 3 * * *', async () => {
    await sendDatabaseBackup('Cron');
});

// Manual trigger
app.post('/api/backup/trigger', async (req, res) => {
    const success = await sendDatabaseBackup('Manual Trigger');
    if (success) {
        res.json({ success: true, message: 'Backup dispatched to your email!' });
    } else {
        res.status(500).json({ error: 'Failed to dispatch backup. Check server logs.' });
    }
});

// Helper for rate-limiting
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Schedule background sync every hour
cron.schedule('0 * * * *', async () => {
    console.log('[Cron] Running scheduled trip sync...');
    await syncTripsForContext('professional');
    await sleep(5000);
    await syncTripsForContext('personal');
    await sleep(5000);
});

// Optional manual trigger endpoint if needed immediately
app.post('/api/trips/sync', async (req, res) => {
    // The frontend sends a JSON body: { context: "personal" }
    const context = req.body.context || req.query.context || 'both';

    if (context === 'all' || context === 'both') {
        res.json({ success: true, message: 'Full sync started sequentially' });

        // Since we are forcing a full refresh, let's explicitly wipe the db first manually
        await prisma.trip.deleteMany({ where: { contextMode: { in: ['personal', 'professional'] } } });

        await syncTripsForContext('professional');
        await syncTripsForContext('personal');
        return;
    }

    res.json({ success: true, message: `Sync started for context: ${context}` });

    // Wipe just this context to ensure fresh data
    await prisma.trip.deleteMany({ where: { contextMode: context } });
    await syncTripsForContext(context);
});


// --- Trips Helper ---
const getTripsByContext = async (context) => {
    const trips = await prisma.trip.findMany({
        where: { contextMode: context },
        include: { components: true }
    });

    return trips.map(t => ({
        TripName: t.tripName,
        StartDate: t.startDate,
        EndDate: t.endDate,
        Components: t.components.map(c => ({
            Type: c.type,
            Name: c.name,
            Date: c.date,
            Time: c.time,
            Airline: c.airline,
            FlightNumber: c.flightNumber,
            Confirmation: c.confirmation,
            Address: c.address
        }))
    }));
};

// --- Trips Endpoint (Zero-Latency Prisma Read) ---
app.get('/api/trips', async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const context = req.query.context || 'both';
    try {
        if (context === 'both') {
            const profTrips = await getTripsByContext('professional');
            const persTrips = await getTripsByContext('personal');

            let combined = [];
            let needsSync = false;

            if (profTrips.length > 0) {
                combined.push(...profTrips);
            } else {
                syncTripsForContext('professional');
                needsSync = true;
            }

            if (persTrips.length > 0) {
                combined.push(...persTrips);
            } else {
                syncTripsForContext('personal');
                needsSync = true;
            }

            if (needsSync && combined.length === 0) {
                return res.json([]);
            }

            // Re-apply Hotfix 4.9.2 native 14-day deduplication to the merged sets
            if (combined.length > 0) {
                combined.sort((a, b) => new Date(a.StartDate) - new Date(b.StartDate));
                let finalTrips = [combined[0]];

                for (let i = 1; i < combined.length; i++) {
                    const current = combined[i];
                    const last = finalTrips[finalTrips.length - 1];
                    const lastEnd = new Date(last.EndDate || last.StartDate);
                    const currentStart = new Date(current.StartDate);

                    const diffTime = Math.abs(currentStart - lastEnd);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                    if (diffDays <= 2) {
                        const lastBaseName = last.TripName.split(' & ')[0];
                        const currentBaseName = current.TripName.split(' & ')[0];
                        if (!last.TripName.includes(currentBaseName)) {
                            last.TripName = `${lastBaseName} & ${currentBaseName}`;
                        }
                        if (new Date(current.EndDate || current.StartDate) > lastEnd) {
                            last.EndDate = current.EndDate || current.StartDate;
                        }
                        // Important: Check for duplicate components before merging
                        const existingTitles = new Set((last.Components || []).map(c => c.Name));
                        const uniqueNewComps = (current.Components || []).filter(c => !existingTitles.has(c.Name));
                        last.Components = [...(last.Components || []), ...uniqueNewComps];
                    } else {
                        finalTrips.push(current);
                    }
                }
                combined = finalTrips;
            }

            res.json(combined);
        } else {
            const trips = await getTripsByContext(context);
            if (trips.length > 0) {
                res.json(trips);
            } else {
                syncTripsForContext(context);
                res.json([]);
            }
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// AI Auto-Scheduling Endpoint
app.post('/api/ai/schedule', async (req, res) => {
    try {
        const { taskTitle, calendarEvents } = req.body;

        if (!process.env.GEMINI_API_KEY) {
            return res.status(400).json({ error: 'Gemini API Key is missing. Please add it to your .env file.' });
        }

        const prompt = `
You are an intelligent executive assistant like Sunsama.
Your goal is to look at a user's task and their upcoming calendar schedule, and determine the BEST 30-minute to 1-hour time slot for them to complete this task.
The user works roughly 9 AM to 5 PM.Do not schedule tasks during their existing calendar events.Do not schedule tasks in the past.
Assume today is ${new Date().toLocaleDateString()} and the time is ${new Date().toLocaleTimeString('en-US', { hour12: false })}.

Task to schedule: "${taskTitle}"

User's upcoming calendar events:
${JSON.stringify(calendarEvents, null, 2)}

Respond with ONLY a valid JSON object in the exact following format, with no markdown formatting or extra text:
        {
            "recommendedTime": "YYYY-MM-DDTHH:MM:SSZ",
                "reasoning": "A short, 1-sentence explanation of why you chose this time."
        }
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        let responseText = response.text.replace(/```json/gi, '').replace(/```/g, '').trim();

        const suggestion = JSON.parse(responseText);
        res.json(suggestion);

    } catch (err) {
        console.error("AI Scheduling Error:", err);
        res.status(500).json({ error: 'Failed to generate AI schedule.' });
    }
});

// --- Pomodoro Endpoints ---
app.post('/api/pomodoros', express.json(), async (req, res) => {
    try {
        const { duration_minutes, task_id_optional } = req.body;
        const result = await prisma.pomodoro.create({
            data: {
                durationMinutes: duration_minutes,
                completedAt: new Date().toISOString(),
                taskIdOptional: task_id_optional || null
            }
        });
        res.status(201).json({ id: result.id, message: 'Pomodoro logged successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to log Pomodoro' });
    }
});

app.get('/api/pomodoros/stats', async (req, res) => {
    try {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);

        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(today.getDate() - 6);
        const isoSevenAuth = sevenDaysAgo.toISOString();

        const rawStats = await prisma.$queryRaw`
            SELECT 
                date(completedAt) as date,
                SUM(durationMinutes) as minutes
            FROM Pomodoro
            WHERE date(completedAt) >= date(${isoSevenAuth})
            GROUP BY date(completedAt)
            ORDER BY date(completedAt) ASC
        `;

        // Build 7-day array
        const heatmap = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(sevenDaysAgo);
            d.setDate(sevenDaysAgo.getDate() + i);
            const dateStr = d.toISOString().split('T')[0];

            const existing = rawStats.find(r => r.date.startsWith(dateStr));
            heatmap.push({
                date: dateStr,
                minutes: existing ? Number(existing.minutes) : 0
            });
        }

        const todayStr = today.toISOString().split('T')[0];
        const todayMins = heatmap.find(h => h.date === todayStr)?.minutes || 0;

        res.json({
            today: todayMins,
            heatmap: heatmap
        });
    } catch (err) {
        console.error("Pomodoro Stats Error:", err);
        res.status(500).json({ error: 'Failed to fetch Pomodoro stats' });
    }
});

// --- MailCraft SSE Endpoint ---
const TONE_LABELS = {
    professional: "Professional",
    warm: "Warm",
    concise: "Concise",
    friendly: "Friendly",
    formal: "Formal",
    persuasive: "Persuasive",
    apologetic: "Apologetic",
    grateful: "Grateful",
};

const TONE_DESCRIPTIONS = {
    professional: "Clear, polished, and business-appropriate. Confident without being stiff.",
    warm: "Friendly and personable with genuine warmth. Approachable yet respectful.",
    concise: "Brief and to the point. Every sentence earns its place. No filler.",
    friendly: "Casual and upbeat. Like writing to a colleague you get along with.",
    formal: "Traditional business correspondence. Proper structure and courteous language.",
    persuasive: "Compelling and action-oriented. Builds a clear case with confident language.",
    apologetic: "Sincere and accountable. Acknowledges the issue and offers a path forward.",
    grateful: "Genuinely thankful and appreciative. Specific about what you value.",
};

function buildSystemPrompt(tone) {
    return `You are an expert email writer. Your task is to transform the user's rough thoughts into a polished, well-structured email.

Tone: ${TONE_LABELS[tone]} — ${TONE_DESCRIPTIONS[tone]}

Rules:
- Write ONLY the email body. No subject line, no meta-commentary, no explanations.
- Start directly with the greeting (e.g., "Hi Sarah," or "Dear Mr. Thompson,").
- End with an appropriate sign-off (e.g., "Best regards," or "Thanks,") followed by a blank line for the sender's name.
- Match the tone precisely. Every word should feel intentional.
- Keep paragraphs short (2-3 sentences max) for readability.
- If the user provides context about an email they're replying to, weave in relevant references naturally.
- Never use placeholder brackets like [Name] — if information is missing, write around it gracefully.
- Do not include a subject line or any text before the greeting.`;
}

function buildUserMessage(rawThoughts, replyContext) {
    let message = `Here are my rough thoughts for this email:\n\n${rawThoughts}`;
    if (replyContext && replyContext.trim().length > 0) {
        message += `\n\n---\n\nThis is a reply to the following email:\n\n${replyContext}`;
    }
    return message;
}

app.post('/api/mailcraft', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { draftText, tone, replyContext } = req.body;
    if (!draftText || !tone) {
        res.write(`data: ${JSON.stringify({ error: "Missing required fields: draftText and tone" })}\n\n`);
        return res.end();
    }

    try {
        if (!ai) {
            throw new Error("Gemini AI is not initialized. Please configure GEMINI_API_KEY.");
        }

        const responseStream = await ai.models.generateContentStream({
            model: 'gemini-2.5-flash',
            contents: buildUserMessage(draftText, replyContext),
            config: {
                systemInstruction: buildSystemPrompt(tone),
                maxOutputTokens: 1024
            }
        });

        req.on('close', () => {
            // connection broke, we can't cleanly abort generator but we can listen
        });

        for await (const chunk of responseStream) {
            if (req.destroyed) break;
            if (chunk.text) {
                res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
            }
        }

        if (!req.destroyed) {
            res.write('data: [DONE]\n\n');
            res.end();
        }
    } catch (err) {
        console.error("MailCraft error:", err);
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
    }
});

// --- MailCraft Send Endpoint ---
app.post('/api/mailcraft/send', async (req, res) => {
    const { replyToMessageId, payloadText } = req.body;
    if (!replyToMessageId || !payloadText) {
        return res.status(400).json({ error: "Missing replyToMessageId or payloadText" });
    }

    try {
        const auth = await getOAuth2Client();
        if (!auth) {
            return res.status(401).json({ error: "Missing Google authentication." });
        }
        const gmail = google.gmail({ version: 'v1', auth });

        // Fetch original message to get headers for reply
        const originalMessage = await gmail.users.messages.get({
            userId: 'me',
            id: replyToMessageId,
            format: 'metadata',
            metadataHeaders: ['Message-ID', 'Subject', 'From', 'To', 'Cc']
        });

        const headers = originalMessage.data.payload.headers;
        const originalMessageId = headers.find(h => h.name === 'Message-ID')?.value || '';
        let subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
        if (!subject.startsWith('Re:')) {
            subject = 'Re: ' + subject;
        }

        const to = headers.find(h => h.name === 'From')?.value || '';

        const messageParts = [
            `To: ${to}`,
            `Subject: ${subject}`,
            `In-Reply-To: ${originalMessageId}`,
            `References: ${originalMessageId}`,
            `Content-Type: text/plain; charset="UTF-8"`,
            '',
            payloadText
        ];
        const message = messageParts.join('\n');

        // Base64url encode for Gmail API
        const encodedMessage = Buffer.from(message)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        // Send via Gmail
        await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage,
                threadId: originalMessage.data.threadId // Keep it in the same thread
            }
        });

        res.json({ success: true });
    } catch (err) {
        console.error("Failed to send MailCraft reply:", err);
        res.status(500).json({ error: err.message, requiresAuth: err.message.includes('authenticate') });
    }
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws) => {
    console.log('[WebSocket] Client connected');
    ws.on('close', () => console.log('[WebSocket] Client disconnected'));
});

// Broadcast helper for real-time UI updates
function broadcastEvent(type, payload) {
    const message = JSON.stringify({ type, payload });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

if (require.main === module) {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT} (0.0.0.0 binding)`);
    });
}

module.exports = app;
