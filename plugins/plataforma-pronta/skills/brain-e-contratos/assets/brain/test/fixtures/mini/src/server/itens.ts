import { Hono } from 'hono';
import { requireAuth } from './middleware';

export const itens = new Hono();
itens.get('/', requireAuth, (c) => c.json([]));
itens.post('/:id', async (c) => {
  await c.env.DB.prepare('insert into itens (id) values (?)').run();
  return c.json({});
});
