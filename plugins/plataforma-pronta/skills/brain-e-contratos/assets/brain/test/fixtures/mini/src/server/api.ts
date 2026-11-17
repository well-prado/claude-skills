import { Hono } from 'hono';
import { itens } from './itens';
import { requireAuth } from './middleware';
import { extras } from './extras';

export const app = new Hono().basePath('/v1');
const admin = new Hono();
admin.use('*', requireAuth);
admin.get('/painel', (c) => c.json({}));

app.use('/restrito/*', requireAuth);
app.get('/restrito/ficha', (c) => c.json({}));
app.get('/livre', (c) => c.json({}));

app.route('/itens', itens);
app.route('/admin', admin);

export function criarApp() {
  const raiz = new Hono();
  for (const r of [extras]) raiz.route('/x', r);
  return raiz;
}
