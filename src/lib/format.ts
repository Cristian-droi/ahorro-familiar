// Helpers de formato compartidos entre páginas del dashboard. Todos asumen
// contexto es-CO.

export const cop = (n: number | null | undefined): string => {
  if (n == null) return '$ 0';
  return '$ ' + new Intl.NumberFormat('es-CO').format(Math.round(n));
};

const monthNamesLong = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const monthNamesShort = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

// "YYYY-MM-01" → "Enero" / "Enero 2026"
export function monthLabel(isoMonth: string, withYear = false): string {
  const [year, month] = isoMonth.split('-').map(Number);
  const name = monthNamesLong[month - 1] ?? '';
  return withYear ? `${name} ${year}` : name;
}

// ISO timestamp → "14 abr 2026"
export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const m = monthNamesShort[d.getMonth()];
  const y = d.getFullYear();
  return `${day} ${m} ${y}`;
}

// ISO timestamp → "14 abr 2026, 3:20 p.m."
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = formatShortDate(iso);
  const time = d.toLocaleTimeString('es-CO', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${date}, ${time}`;
}

// Etiqueta legible para los conceptos del dominio.
export function conceptLabel(concept: string): string {
  switch (concept) {
    case 'acciones':
      return 'Acciones';
    case 'acciones_prestamo':
      return 'Acciones por préstamo';
    case 'pago_capital':
      return 'Pago a capital';
    case 'pago_intereses':
      return 'Pago de intereses';
    case 'capitalizacion':
      return 'Capitalización';
    case 'multa_acciones':
      return 'Multa por mora';
    case 'otros':
      return 'Otros';
    default:
      return concept;
  }
}

// Etiqueta legible para el motivo de rechazo de un recibo.
export function rejectionReasonLabel(
  reason: 'amount_mismatch' | 'payment_not_received' | null | undefined,
): string {
  switch (reason) {
    case 'amount_mismatch':
      return 'El monto no coincide con la transferencia';
    case 'payment_not_received':
      return 'La transferencia no llegó a la cuenta';
    default:
      return '';
  }
}

// Etiqueta de estado del recibo.
export function receiptStatusLabel(
  status: 'pending' | 'approved' | 'rejected',
): string {
  switch (status) {
    case 'pending':
      return 'Pendiente de revisión';
    case 'approved':
      return 'Aprobado';
    case 'rejected':
      return 'Rechazado';
  }
}
