// Shared guard for payment inputs: a loan or a month can appear only once.

export function hayRepetidos(claves: string[]): boolean {
  return new Set(claves).size !== claves.length;
}
