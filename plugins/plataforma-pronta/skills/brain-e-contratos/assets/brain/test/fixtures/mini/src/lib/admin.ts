export function criarClienteAdmin() {
  return { from: (_t: string) => ({ insert: (_x: unknown) => ({}), select: () => ({}) }) };
}
