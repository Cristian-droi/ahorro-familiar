// Result type for expected domain errors (docs/convenciones.md, section 4).
// Business-rule failures are returned, never thrown.

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export interface ErrorDeDominio {
  // Stable machine-readable code, e.g. 'intereses_pendientes'.
  codigo: string;
  // User-facing message in clear Spanish.
  mensaje: string;
}

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function err<E>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}
