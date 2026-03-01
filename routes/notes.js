module.exports = function ({ prisma }) {
    const router = require('express').Router();

    router.get('/notes', async (req, res) => {
        const context = req.query.context || 'both';
        try {
            let note = await prisma.note.findFirst({ where: { contextMode: context } });
            if (!note) {
                note = await prisma.note.create({ data: { content: "", contextMode: context } });
            }
            res.json(note);
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.post('/notes', async (req, res) => {
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

    return router;
};
