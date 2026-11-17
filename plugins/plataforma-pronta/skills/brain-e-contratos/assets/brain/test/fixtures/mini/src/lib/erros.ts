export function registrarErro(_e: unknown) {}

export function vazio() {
  try { JSON.parse('x'); } catch {}
}

export function comRegistro() {
  try { JSON.parse('x'); } catch (e) { registrarErro(e); }
}

export function comMotivo() {
  try { JSON.parse('x'); } catch {
    // texto malformado é esperado aqui: o padrão vale
  }
}
