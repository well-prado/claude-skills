export async function requireAuth(_c: unknown, next: () => Promise<void>) {
  await next();
}
