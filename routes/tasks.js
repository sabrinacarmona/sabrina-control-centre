module.exports = function ({ prisma }) {
    const router = require('express').Router();

    router.get('/tasks', async (req, res) => {
        const context = req.query.context || 'both';
        try {
            const tasks = context === 'both'
                ? await prisma.task.findMany()
                : await prisma.task.findMany({ where: { contextMode: { in: [context, 'both'] } } });
            res.json(tasks.map(t => ({ ...t, context_mode: t.contextMode, source_reference: t.sourceReference })));
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.post('/tasks', async (req, res) => {
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
                            sourceReference: t.source_reference,
                        })),
                    });
                }
            });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    return router;
};
