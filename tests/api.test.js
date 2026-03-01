const request = require('supertest');
const { PrismaClient } = require('@prisma/client');

// Set AUTH_PASSWORD before loading app so the auth middleware activates
process.env.AUTH_PASSWORD = 'test-secret';

const app = require('../server');
const prisma = new PrismaClient();

const AUTH = `Bearer ${process.env.AUTH_PASSWORD}`;

beforeAll(async () => {
    // Clean slate for each test run
    await prisma.task.deleteMany();
    await prisma.ritual.deleteMany();
    await prisma.note.deleteMany();
    await prisma.pomodoro.deleteMany();
});

afterAll(async () => {
    await prisma.$disconnect();
});

// ──────────────────────────────
// Auth Middleware
// ──────────────────────────────
describe('Auth middleware', () => {
    it('POST /api/auth/login succeeds with correct password', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ password: 'test-secret' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('POST /api/auth/login rejects wrong password', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ password: 'wrong' });
        expect(res.status).toBe(401);
    });

    it('GET /api/tasks returns 401 without token', async () => {
        const res = await request(app).get('/api/tasks');
        expect(res.status).toBe(401);
    });

    it('GET /api/tasks returns 200 with valid token', async () => {
        const res = await request(app)
            .get('/api/tasks')
            .set('Authorization', AUTH);
        expect(res.status).toBe(200);
    });
});

// ──────────────────────────────
// Tasks CRUD
// ──────────────────────────────
describe('Tasks API', () => {
    it('GET /api/tasks returns empty array initially', async () => {
        const res = await request(app)
            .get('/api/tasks?context=both')
            .set('Authorization', AUTH);
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    it('POST /api/tasks saves tasks', async () => {
        const tasks = [
            { id: '1', title: 'Test task 1', status: 'todo', context_mode: 'both' },
            { id: '2', title: 'Test task 2', status: 'doing', context_mode: 'both' },
        ];
        const res = await request(app)
            .post('/api/tasks?context=both')
            .set('Authorization', AUTH)
            .send(tasks);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('GET /api/tasks returns saved tasks', async () => {
        const res = await request(app)
            .get('/api/tasks?context=both')
            .set('Authorization', AUTH);
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        expect(res.body[0].title).toBe('Test task 1');
    });

    it('POST /api/tasks replaces tasks for context', async () => {
        const tasks = [
            { id: '3', title: 'Replaced task', status: 'todo', context_mode: 'both' },
        ];
        await request(app)
            .post('/api/tasks?context=both')
            .set('Authorization', AUTH)
            .send(tasks);

        const res = await request(app)
            .get('/api/tasks?context=both')
            .set('Authorization', AUTH);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].title).toBe('Replaced task');
    });
});

// ──────────────────────────────
// Notes CRUD
// ──────────────────────────────
describe('Notes API', () => {
    it('GET /api/notes creates and returns empty note', async () => {
        const res = await request(app)
            .get('/api/notes?context=both')
            .set('Authorization', AUTH);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('content');
    });

    it('POST /api/notes saves content', async () => {
        const res = await request(app)
            .post('/api/notes?context=both')
            .set('Authorization', AUTH)
            .send({ content: 'Hello world' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('GET /api/notes returns saved content', async () => {
        const res = await request(app)
            .get('/api/notes?context=both')
            .set('Authorization', AUTH);
        expect(res.body.content).toBe('Hello world');
    });
});

// ──────────────────────────────
// Rituals CRUD
// ──────────────────────────────
describe('Rituals API', () => {
    let ritualId;

    it('POST /api/rituals creates a ritual', async () => {
        const res = await request(app)
            .post('/api/rituals')
            .set('Authorization', AUTH)
            .send({ title: 'Morning run', context_mode: 'personal' });
        expect(res.status).toBe(200);
        expect(res.body.title).toBe('Morning run');
        ritualId = res.body.id;
    });

    it('POST /api/rituals rejects missing title', async () => {
        const res = await request(app)
            .post('/api/rituals')
            .set('Authorization', AUTH)
            .send({});
        expect(res.status).toBe(400);
    });

    it('GET /api/rituals returns rituals including created one', async () => {
        const res = await request(app)
            .get('/api/rituals?context=personal')
            .set('Authorization', AUTH);
        expect(res.status).toBe(200);
        const created = res.body.find(r => r.id === ritualId);
        expect(created).toBeDefined();
        expect(created.title).toBe('Morning run');
        expect(created.completed).toBe(false);
    });

    it('PUT /api/rituals/:id toggles completion', async () => {
        const res = await request(app)
            .put(`/api/rituals/${ritualId}`)
            .set('Authorization', AUTH)
            .send({ completed: true });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('DELETE /api/rituals/:id removes ritual', async () => {
        const res = await request(app)
            .delete(`/api/rituals/${ritualId}`)
            .set('Authorization', AUTH);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const list = await request(app)
            .get('/api/rituals?context=personal')
            .set('Authorization', AUTH);
        const deleted = list.body.find(r => r.id === ritualId);
        expect(deleted).toBeUndefined();
    });
});

// ──────────────────────────────
// Pomodoros
// ──────────────────────────────
describe('Pomodoros API', () => {
    it('POST /api/pomodoros records a session', async () => {
        const res = await request(app)
            .post('/api/pomodoros')
            .set('Authorization', AUTH)
            .send({ duration_minutes: 25 });
        expect(res.status).toBe(201);
        expect(res.body).toHaveProperty('id');
    });

    it('GET /api/pomodoros/stats returns stats', async () => {
        const res = await request(app)
            .get('/api/pomodoros/stats')
            .set('Authorization', AUTH);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('today');
        expect(res.body).toHaveProperty('heatmap');
        expect(Array.isArray(res.body.heatmap)).toBe(true);
    });
});
