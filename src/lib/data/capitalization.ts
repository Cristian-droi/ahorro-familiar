// Helpers para la ventana de capitalizaciones. El estado vive en
// system_settings.capitalization_window y lo consulta el RPC
// `get_capitalization_window_state`, que además cuenta el recaudo actual
// (pending + approved desde opened_at). El RPC es security definer, así que
// tanto admins como accionistas obtienen la misma foto.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type Client = SupabaseClient<Database>;

// Motivos posibles de cierre. `null` cuando está abierta. `not_configured`
// indica que la fila en system_settings aún no existe (caso teórico post-fresh
// install si la migración no corrió).
export type CapitalizationCloseReason =
  | 'disabled'
  | 'closed_manually'
  | 'deadline_passed'
  | 'target_reached'
  | 'not_configured'
  | null;

export interface CapitalizationWindowState {
  is_open: boolean;
  close_reason: CapitalizationCloseReason;
  enabled: boolean;
  target_amount: number;
  deadline: string | null; // 'YYYY-MM-DD'
  opened_at: string | null; // ISO timestamp
  closed_manually: boolean;
  recaudado: number;
  percentage: number; // 0-100
}

function toState(raw: unknown): CapitalizationWindowState {
  const v = (raw ?? {}) as Record<string, unknown>;
  return {
    is_open: Boolean(v.is_open),
    close_reason: (v.close_reason as CapitalizationCloseReason) ?? null,
    enabled: Boolean(v.enabled),
    target_amount: Number(v.target_amount ?? 0),
    deadline: (v.deadline as string | null) ?? null,
    opened_at: (v.opened_at as string | null) ?? null,
    closed_manually: Boolean(v.closed_manually),
    recaudado: Number(v.recaudado ?? 0),
    percentage: Number(v.percentage ?? 0),
  };
}

// Lee el estado vigente — úsalo tanto en cliente como en server.
export async function getCapitalizationWindowState(
  client: Client,
): Promise<CapitalizationWindowState> {
  const { data, error } = await client.rpc('get_capitalization_window_state');
  if (error) throw error;
  return toState(data);
}

// Solo admin. Abre la ventana con monto objetivo y fecha límite.
export async function openCapitalizationWindow(
  client: Client,
  args: { targetAmount: number; deadline: string },
): Promise<CapitalizationWindowState> {
  const { data, error } = await client.rpc('open_capitalization_window', {
    p_target_amount: args.targetAmount,
    p_deadline: args.deadline,
  });
  if (error) throw error;
  return toState(data);
}

// Solo admin. Marca la ventana como cerrada manualmente.
export async function closeCapitalizationWindow(
  client: Client,
): Promise<CapitalizationWindowState> {
  const { data, error } = await client.rpc('close_capitalization_window');
  if (error) throw error;
  return toState(data);
}

// Etiqueta humana del motivo de cierre para la UI.
export function closeReasonLabel(reason: CapitalizationCloseReason): string {
  switch (reason) {
    case 'disabled':
      return 'No habilitada por el administrador';
    case 'closed_manually':
      return 'Cerrada por el administrador';
    case 'deadline_passed':
      return 'La fecha límite ya pasó';
    case 'target_reached':
      return 'Se alcanzó el monto objetivo';
    case 'not_configured':
      return 'Sin configurar';
    default:
      return '';
  }
}
