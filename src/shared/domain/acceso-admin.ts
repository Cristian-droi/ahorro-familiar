// Administrative access (docs/prd.md, section 3). Every user is a shareholder;
// an administrative role is added on top of that.

export type RolAdmin = 'gerente' | 'tesorero';

const PREFIJOS_ADMIN = ['/dashboard/admin', '/dashboard/solicitudes', '/dashboard/miembros', '/dashboard/libro-caja'];

// The gerente reads all the administrative information.
export function puedeLeerAdmin(rol: RolAdmin | null): boolean {
  return rol !== null;
}

// Only the tesorero writes. The gerente's second signature belongs to phase 1b.
export function puedeEscribirAdmin(rol: RolAdmin | null): boolean {
  return rol === 'tesorero';
}

export function esRutaAdmin(ruta: string): boolean {
  return PREFIJOS_ADMIN.some((prefijo) => ruta === prefijo || ruta.startsWith(`${prefijo}/`));
}

export function rutaDeInicio(rol: RolAdmin | null): string {
  return puedeLeerAdmin(rol) ? '/dashboard/admin' : '/dashboard/accionista';
}
