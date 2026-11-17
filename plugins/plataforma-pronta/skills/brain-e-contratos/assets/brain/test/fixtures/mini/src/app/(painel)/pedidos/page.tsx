import { exigirLogin } from '@/lib/auth';

async function Pedidos() {
  await exigirLogin();
  return null;
}
export default Pedidos;
