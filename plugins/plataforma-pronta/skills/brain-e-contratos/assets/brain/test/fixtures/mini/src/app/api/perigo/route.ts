import { criarClienteAdmin } from '@/lib/admin';

export async function POST() {
  criarClienteAdmin().from('logs').insert({ x: 1 });
  return Response.json({ ok: true });
}
