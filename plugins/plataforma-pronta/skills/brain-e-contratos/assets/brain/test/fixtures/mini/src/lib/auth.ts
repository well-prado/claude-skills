export async function exigirLogin() {
  return { id: 'u1' };
}

/** Guarda indireta: confere o login por dentro (o brain segue a chamada). */
export async function podeEscrever() {
  return exigirLogin();
}
