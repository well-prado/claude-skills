import { exigirLogin, podeEscrever } from '@/lib/auth';
import { supabase } from '@/lib/banco';
import { criarClienteAdmin } from '@/lib/admin';

export async function GET() {
  await exigirLogin();
  return Response.json(criarClienteAdmin().from('pedidos').select());
}

export const POST = async () => {
  await podeEscrever();
  supabase.from('pedidos').insert({ total: 1 });
  return Response.json({ ok: true });
};
