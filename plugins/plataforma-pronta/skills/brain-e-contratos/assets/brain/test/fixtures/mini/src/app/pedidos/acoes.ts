'use server';
import { podeEscrever } from '@/lib/auth';
import { supabase } from '@/lib/banco';

export async function criarPedido() {
  await podeEscrever();
  supabase.from('pedidos').insert({ total: 2 });
}

export async function apagarTudo() {
  supabase.from('pedidos').delete();
}

export const lerResumo = async () => {
  return supabase.from('pedidos').select();
};
