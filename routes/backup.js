const fs = require('fs');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');

module.exports = function ({ getOAuth2Client, DB_PATH }) {
    const router = require('express').Router();

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
            const profile = await google.gmail({ version: 'v1', auth }).users.getProfile({ userId: 'me' });
            const userEmail = profile.data.emailAddress;

            const dbBuffer = fs.readFileSync(DB_PATH);
            const dateStr = new Date().toISOString().split('T')[0];

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
                },
            });

            await transporter.sendMail({
                from: `"SabrinaOS Auto-Pilot" <${userEmail}>`,
                to: userEmail,
                subject: `SabrinaOS Daily DB Backup (${dateStr})`,
                text: `Attached is your latest SabrinaOS SQLite database backup (database_backup_${dateStr}.db). Triggered by: ${triggerSource}.\n\nKeep this safe!`,
                attachments: [
                    {
                        filename: `database_backup_${dateStr}.db`,
                        content: dbBuffer,
                        contentType: 'application/x-sqlite3',
                    },
                ],
            });

            console.log(`[Backup] Successfully emailed database to ${userEmail} via nodemailer`);
            return true;
        } catch (err) {
            console.error(`[Backup] Failed to send database backup:`, err);
            return false;
        }
    };

    router.post('/backup/trigger', async (req, res) => {
        const success = await sendDatabaseBackup('Manual Trigger');
        if (success) {
            res.json({ success: true, message: 'Backup dispatched to your email!' });
        } else {
            res.status(500).json({ error: 'Failed to dispatch backup. Check server logs.' });
        }
    });

    // Expose for cron jobs in server.js
    router.sendDatabaseBackup = sendDatabaseBackup;

    return router;
};
