const { google } = require('googleapis');

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

module.exports = function ({ ai, getOAuth2Client }) {
    const router = require('express').Router();

    // SSE streaming endpoint
    router.post('/mailcraft', async (req, res) => {
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
                    maxOutputTokens: 1024,
                },
            });

            req.on('close', () => {
                // connection broke
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

    // Send reply via Gmail
    router.post('/mailcraft/send', async (req, res) => {
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

            const originalMessage = await gmail.users.messages.get({
                userId: 'me',
                id: replyToMessageId,
                format: 'metadata',
                metadataHeaders: ['Message-ID', 'Subject', 'From', 'To', 'Cc'],
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
                payloadText,
            ];
            const message = messageParts.join('\n');

            const encodedMessage = Buffer.from(message)
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

            await gmail.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: encodedMessage,
                    threadId: originalMessage.data.threadId,
                },
            });

            res.json({ success: true });
        } catch (err) {
            console.error("Failed to send MailCraft reply:", err);
            res.status(500).json({ error: err.message, requiresAuth: err.message.includes('authenticate') });
        }
    });

    return router;
};
