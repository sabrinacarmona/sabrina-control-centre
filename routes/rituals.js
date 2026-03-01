module.exports = function ({ prisma }) {
    const router = require('express').Router();

    router.get('/rituals', async (req, res) => {
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

    router.put('/rituals/:id', async (req, res) => {
        const { id } = req.params;
        const { completed } = req.body;
        try {
            await prisma.ritual.update({ where: { id }, data: { completed: completed ? 1 : 0 } });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.post('/rituals', async (req, res) => {
        const { title, context_mode = 'both' } = req.body;
        if (!title) return res.status(400).json({ error: 'Title required' });
        const id = Date.now().toString();
        const today = new Date().toDateString();

        try {
            await prisma.ritual.create({
                data: { id, title, completed: 0, lastResetDate: today, contextMode: context_mode },
            });
            res.json({ id, title, completed: false, lastResetDate: today, context_mode });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.delete('/rituals/:id', async (req, res) => {
        const { id } = req.params;
        try {
            await prisma.ritual.delete({ where: { id } });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    return router;
};
