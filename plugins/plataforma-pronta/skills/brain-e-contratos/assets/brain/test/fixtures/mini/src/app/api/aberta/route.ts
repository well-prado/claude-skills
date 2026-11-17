import { supabase } from '../../../lib/banco';

export async function DELETE() {
  supabase.from('pedidos').delete();
  return new Response(null, { status: 204 });
}
