const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const NodeCache = require('node-cache');
const cron = require('node-cron');
const { GoogleGenAI } = require('@google/genai');
const { google } = require('googleapis');
const { getGoogleApiConfig, getOAuth2Client, SCOPES, TOKEN_PATH } = require('./utils/google');

// --- Initialization ---
const DB_PATH = path.resolve(__dirname, (process.env.DATABASE_URL || 'file:./database.db').replace('file:', ''));
const apiCache = new NodeCache({ stdTTL: 300 });

let ai = null;
if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} else {
    console.warn("⚠️  GEMINI_API_KEY not found in environment. Auto-Scheduling AI features will be disabled.");
}

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
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

// --- Auth Gate ---
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

// --- Static Files ---
app.use(express.static(path.join(__dirname)));

// --- WebSocket ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws) => {
    console.log('[WebSocket] Client connected');
    ws.on('close', () => console.log('[WebSocket] Client disconnected'));
});

function broadcastEvent(type, payload) {
    const message = JSON.stringify({ type, payload });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// --- Seed Default Rituals ---
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

// --- Route Wiring ---
const deps = { prisma, ai, getOAuth2Client, getGoogleApiConfig, SCOPES, TOKEN_PATH, apiCache, broadcastEvent, DB_PATH };

const authRouter = require('./routes/auth')(deps);
app.use('/api', authRouter);
app.get('/oauth2callback', authRouter.oauthCallback);

app.use('/api', require('./routes/tasks')(deps));
app.use('/api', require('./routes/notes')(deps));
app.use('/api', require('./routes/rituals')(deps));
app.use('/api', require('./routes/calendar')(deps));
app.use('/api', require('./routes/inbox')(deps));
app.use('/api', require('./routes/ai')(deps));
app.use('/api', require('./routes/pomodoros')(deps));
app.use('/api', require('./routes/mailcraft')(deps));

const tripsRouter = require('./routes/trips')(deps);
app.use('/api', tripsRouter);

const backupRouter = require('./routes/backup')(deps);
app.use('/api', backupRouter);

// --- Cron Jobs ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Renew Gmail Push subscription every 24 hours
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

// Database backup at 3:00 AM
cron.schedule('0 3 * * *', async () => {
    await backupRouter.sendDatabaseBackup('Cron');
});

// Trip sync every hour
cron.schedule('0 * * * *', async () => {
    console.log('[Cron] Running scheduled trip sync...');
    await tripsRouter.syncTripsForContext('professional');
    await sleep(5000);
    await tripsRouter.syncTripsForContext('personal');
    await sleep(5000);
});

// --- Start Server ---
if (require.main === module) {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT} (0.0.0.0 binding)`);
    });
}

module.exports = app;
