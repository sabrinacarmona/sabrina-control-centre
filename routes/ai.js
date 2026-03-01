module.exports = function ({ ai }) {
    const router = require('express').Router();

    router.post('/ai/schedule', async (req, res) => {
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

    return router;
};
