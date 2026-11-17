import { Hono } from 'hono';

export const extras = new Hono();
extras.get('/extra', (c) => c.json({}));
