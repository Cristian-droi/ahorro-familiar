import { describe, it, expect } from 'vitest';
import {
  shareValueChangePermissionError,
  shareValueChoiceErrorMessage,
} from '@/lib/data/share-value';
import {
  MENSAJE_PERIODO_NO_ABIERTO,
  MENSAJE_VALOR_BLOQUEADO_POR_COMPRA,
  MENSAJE_VALOR_YA_ELEGIDO,
} from '@/modules/acciones/domain/valor-de-accion';

describe('shareValueChoiceErrorMessage (choose_share_value, RN-2.2)', () => {
  it('maps share_value_locked_by_purchase to the purchase lock message', () => {
    expect(
      shareValueChoiceErrorMessage('share_value_locked_by_purchase Ya hay un recibo con acciones en el periodo (RN-2.2).'),
    ).toBe(MENSAJE_VALOR_BLOQUEADO_POR_COMPRA);
  });

  it('maps share_value_locked to the ask-the-admin message', () => {
    expect(
      shareValueChoiceErrorMessage('share_value_locked El administrador debe habilitar el cambio (RN-2.2).'),
    ).toBe(MENSAJE_VALOR_YA_ELEGIDO);
  });

  it('maps period_not_open to the domain message', () => {
    expect(shareValueChoiceErrorMessage('period_not_open ')).toBe(MENSAJE_PERIODO_NO_ABIERTO);
  });

  it('maps share_value_not_allowed to the reload message', () => {
    expect(shareValueChoiceErrorMessage('share_value_not_allowed ')).toBe(
      'El valor de la acción ya no está entre los permitidos. Recarga la página y elige otro.',
    );
  });

  it('returns null for an unknown error', () => {
    expect(shareValueChoiceErrorMessage('connection reset ')).toBeNull();
  });
});

describe('shareValueChangePermissionError (allow_share_value_change, RN-2.2)', () => {
  it('answers 403 for not_admin', () => {
    expect(shareValueChangePermissionError('not_admin ')).toEqual({
      status: 403,
      message: 'Acceso restringido a administradores',
    });
  });

  it('answers 400 when the shareholder already bought shares', () => {
    expect(shareValueChangePermissionError('share_value_locked_by_purchase Ya hay un recibo (RN-2.2).')).toEqual({
      status: 400,
      message: 'Este accionista ya compró acciones con su valor. Podrá cambiarlo en el próximo periodo.',
    });
  });

  it('answers 400 when the shareholder has not chosen a value', () => {
    expect(shareValueChangePermissionError('share_value_not_chosen ')).toEqual({
      status: 400,
      message: 'Este accionista todavía no eligió el valor de su acción.',
    });
  });

  it('answers 400 when no period is open', () => {
    expect(shareValueChangePermissionError('period_not_open ')?.status).toBe(400);
  });

  it('returns null for an unknown error', () => {
    expect(shareValueChangePermissionError('connection reset ')).toBeNull();
  });
});
