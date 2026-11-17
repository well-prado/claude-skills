import { exigirLogin } from '@/lib/auth';

export default async function Layout({ children }: { children: unknown }) {
  await exigirLogin();
  return children;
}
