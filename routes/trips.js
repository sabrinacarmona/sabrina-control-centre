const { google } = require('googleapis');
const { TripsResponseSchema } = require('../schemas/zodSchemas');
const { deduplicateTrips } = require('../utils/deduplication');

module.exports = function ({ prisma, getOAuth2Client, ai, broadcastEvent }) {
    const router = require('express').Router();
    const activeSyncs = new Set();

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
                            })),
                        },
                    },
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
                    maxResults: 50,
                });
                if (response.data.messages) {
                    const msgs = await Promise.all(response.data.messages.map(async (m) => {
                        const detail = await gmail.users.messages.get({
                            userId: 'me',
                            id: m.id,
                            format: 'metadata',
                            metadataHeaders: ['Subject', 'Date'],
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
                            description: e.description || '',
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

            // Zod Schema Validation
            const parsedTrips = TripsResponseSchema.parse(rawParsedTrips);

            // JS-Level deduplication
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

    const getTripsByContext = async (context) => {
        const trips = await prisma.trip.findMany({
            where: { contextMode: context },
            include: { components: true },
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
                Address: c.address,
            })),
        }));
    };

    // --- Gmail Webhook ---
    router.post('/webhooks/gmail', async (req, res) => {
        try {
            const message = req.body.message;
            if (!message || !message.data) {
                return res.status(400).send('Bad Request: Invalid Pub/Sub message format');
            }

            const decodedData = Buffer.from(message.data, 'base64').toString('utf-8');
            const payload = JSON.parse(decodedData);

            console.log(`[Webhook] Received Gmail push notification for user: ${payload.emailAddress}`);

            res.status(200).send('OK');

            const auth = await getOAuth2Client();
            if (auth) {
                syncTripsForContext('professional');
                syncTripsForContext('personal');
            }
        } catch (err) {
            console.error('[Webhook] Error processing Gmail notification:', err);
            res.status(500).send('Internal Server Error');
        }
    });

    // --- Manual Sync Trigger ---
    router.post('/trips/sync', async (req, res) => {
        const context = req.body.context || req.query.context || 'both';

        if (context === 'all' || context === 'both') {
            res.json({ success: true, message: 'Full sync started sequentially' });

            await prisma.trip.deleteMany({ where: { contextMode: { in: ['personal', 'professional'] } } });

            await syncTripsForContext('professional');
            await syncTripsForContext('personal');
            return;
        }

        res.json({ success: true, message: `Sync started for context: ${context}` });

        await prisma.trip.deleteMany({ where: { contextMode: context } });
        await syncTripsForContext(context);
    });

    // --- Trips Read ---
    router.get('/trips', async (req, res) => {
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

                // Re-apply deduplication to the merged sets
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

    // Expose syncTripsForContext for cron jobs in server.js
    router.syncTripsForContext = syncTripsForContext;

    return router;
};
