'use client';

import { createContext, useContext } from 'react';
import { puedeEscribirAdmin, type RolAdmin } from '@/shared/domain/acceso-admin';

// Loaded once by the dashboard layout. This only hides controls: the server
// (requireAdmin) and RLS are what deny the write.
const AccesoAdminContext = createContext<RolAdmin | null>(null);

export const AccesoAdminProvider = AccesoAdminContext.Provider;

export function useAccesoAdmin() {
  const rolAdmin = useContext(AccesoAdminContext);
  // Also true while the role loads, so no action flashes for the gerente.
  return { rolAdmin, soloLectura: !puedeEscribirAdmin(rolAdmin) };
}
