module.exports = function ({ prisma }) {
    const router = require('express').Router();

    router.post('/pomodoros', async (req, res) => {
        try {
            const { duration_minutes, task_id_optional } = req.body;
            const result = await prisma.pomodoro.create({
                data: {
                    durationMinutes: duration_minutes,
                    completedAt: new Date().toISOString(),
                    taskIdOptional: task_id_optional || null,
                },
            });
            res.status(201).json({ id: result.id, message: 'Pomodoro logged successfully' });
        } catch (err) {
            res.status(500).json({ error: 'Failed to log Pomodoro' });
        }
    });

    router.get('/pomodoros/stats', async (req, res) => {
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

            const heatmap = [];
            for (let i = 0; i < 7; i++) {
                const d = new Date(sevenDaysAgo);
                d.setDate(sevenDaysAgo.getDate() + i);
                const dateStr = d.toISOString().split('T')[0];

                const existing = rawStats.find(r => r.date.startsWith(dateStr));
                heatmap.push({
                    date: dateStr,
                    minutes: existing ? Number(existing.minutes) : 0,
                });
            }

            const todayStr = today.toISOString().split('T')[0];
            const todayMins = heatmap.find(h => h.date === todayStr)?.minutes || 0;

            res.json({
                today: todayMins,
                heatmap: heatmap,
            });
        } catch (err) {
            console.error("Pomodoro Stats Error:", err);
            res.status(500).json({ error: 'Failed to fetch Pomodoro stats' });
        }
    });

    return router;
};
