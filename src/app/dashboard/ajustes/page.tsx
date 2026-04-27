'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import {
  Settings,
  Plus,
  X,
  Save,
  Landmark,
  ChevronDown,
  CheckCircle2,
  Lock,
  Unlock,
  Users,
  TrendingUp,
  CalendarClock,
  PlayCircle,
  PauseCircle,
  UserCog,
  Mail,
  Phone,
  MapPin,
  Wallet,
  IdCard,
} from 'lucide-react';
import {
  getProfile,
  getProfileRole,
  updateProfile,
} from '@/lib/data/profiles';
import {
  closeCapitalizationWindowV2,
  listAdminCapitalizationWindows,
  openGlobalCapitalizationWindow,
  type AdminCapWindow,
} from '@/lib/data/capitalization';
import { showToast } from '@/components/ui/Toast';

const cop = (n: number) => '$ ' + new Intl.NumberFormat('es-CO').format(n);

export default function AjustesPage() {
  const [role, setRole] = useState<'admin' | 'accionista' | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Admin state (lista global de valores permitidos)
  const [allowedShares, setAllowedShares] = useState<number[]>([]);
  const [newShare, setNewShare] = useState('');

  // User state (su propia selección + si puede cambiarla)
  const [selectedShare, setSelectedShare] = useState<number | null>(null);
  const [savedShare, setSavedShare] = useState<number | null>(null);
  const [canChange, setCanChange] = useState<boolean>(true);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Bulk unlock/lock de todos los accionistas (solo admin).
  const [bulkLoading, setBulkLoading] = useState<'allow' | 'revoke' | null>(null);
  // Estadística del estado actual: cuántos accionistas tienen el cambio
  // habilitado vs total. Se usa para mostrar el estado global y deshabilitar
  // el botón que ya no aplicaría (p.ej. "Permitir a todos" cuando ya todos
  // lo tienen habilitado). El admin tiene RLS para leer profiles.
  const [shareChangeStats, setShareChangeStats] = useState<{
    enabled: number;
    total: number;
  } | null>(null);

  // Datos personales (todos los usuarios). Guardamos dos copias: `profileForm`
  // es lo que el usuario está editando y `profileSaved` es el snapshot del
  // último guardado, para detectar cambios y habilitar el botón.
  type ProfileForm = {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address: string;
    monthlyIncome: string; // string con separadores (COP). Se parsea al guardar.
    identityDocument: string; // solo lectura
    bankName: string;
    bankAccountNumber: string;
    bankAccountType: '' | 'ahorros' | 'corriente';
  };
  const emptyProfile: ProfileForm = {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    monthlyIncome: '',
    identityDocument: '',
    bankName: '',
    bankAccountNumber: '',
    bankAccountType: '',
  };
  const [profileForm, setProfileForm] = useState<ProfileForm>(emptyProfile);
  const [profileSaved, setProfileSaved] = useState<ProfileForm>(emptyProfile);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileErrors, setProfileErrors] = useState<
    Partial<Record<keyof ProfileForm, string>>
  >({});
  // Solicitud de cambio de correo pendiente: si existe una fila en
  // email_change_requests sin confirmar/cancelar y no expirada, mostramos
  // un aviso junto al input de correo. RLS deja al usuario verla.
  const [pendingEmailChange, setPendingEmailChange] = useState<{
    id: string;
    newEmail: string;
    expiresAt: string;
  } | null>(null);

  // Capitalizaciones (solo admin ve/edita). En el modelo v2 puede haber
  // múltiples ventanas activas: una global y N individuales (por accionista).
  // Acá solo gestionamos la GLOBAL — las individuales se manejan desde
  // /dashboard/miembros.
  const [capWindows, setCapWindows] = useState<AdminCapWindow[] | null>(null);
  const [capFormOpen, setCapFormOpen] = useState(false);
  const [capDeadlineInput, setCapDeadlineInput] = useState('');
  const [capLoading, setCapLoading] =
    useState<'opening' | 'closing' | string | null>(null);

  const refreshShareChangeStats = useCallback(async () => {
    const [totalRes, enabledRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'accionista'),
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'accionista')
        .eq('share_value_change_allowed', true),
    ]);
    if (totalRes.error) {
      console.error('Error contando accionistas:', totalRes.error);
      return;
    }
    if (enabledRes.error) {
      console.error('Error contando accionistas habilitados:', enabledRes.error);
      return;
    }
    setShareChangeStats({
      total: totalRes.count ?? 0,
      enabled: enabledRes.count ?? 0,
    });
  }, []);

  const refreshCapWindows = useCallback(async () => {
    try {
      const list = await listAdminCapitalizationWindows(supabase);
      setCapWindows(list);
    } catch (err) {
      console.error('Error cargando ventanas de capitalización:', err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let profileChannel: ReturnType<typeof supabase.channel> | null = null;

    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user && !cancelled) {
        setUserId(user.id);

        try {
          const [userRole, profile] = await Promise.all([
            getProfileRole(supabase, user.id),
            getProfile(supabase, user.id),
          ]);
          if (cancelled) return;
          setRole(userRole);

          // Datos personales — para ambos roles. El correo REAL vive en
          // `user.user_metadata.real_email`; `user.email` es el ID sintético
          // de login (<cedula>@ahorro.com) y no se muestra al usuario.
          const realEmail =
            (user.user_metadata as { real_email?: string } | null)?.real_email ??
            '';
          const loaded: ProfileForm = {
            firstName: profile.first_name ?? '',
            lastName: profile.last_name ?? '',
            email: realEmail,
            phone: profile.phone ?? '',
            address: profile.address ?? '',
            monthlyIncome:
              profile.monthly_income != null
                ? new Intl.NumberFormat('es-CO').format(
                    Number(profile.monthly_income),
                  )
                : '',
            identityDocument: profile.identity_document ?? '',
            bankName: profile.bank_name ?? '',
            bankAccountNumber: profile.bank_account_number ?? '',
            bankAccountType: (profile.bank_account_type ?? '') as
              | ''
              | 'ahorros'
              | 'corriente',
          };
          setProfileForm(loaded);
          setProfileSaved(loaded);

          // Solicitud de cambio de correo pendiente (si existe).
          const { data: pending } = await supabase
            .from('email_change_requests')
            .select('id, new_email, expires_at')
            .eq('user_id', user.id)
            .is('confirmed_at', null)
            .is('canceled_at', null)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!cancelled && pending) {
            setPendingEmailChange({
              id: pending.id,
              newEmail: pending.new_email,
              expiresAt: pending.expires_at,
            });
          }

          // Si es admin, cargamos el estado global del flag de cambio
          // para todos los accionistas (habilitados vs total) y la lista
          // de ventanas activas de capitalización.
          if (userRole === 'admin') {
            refreshShareChangeStats();
            try {
              const list = await listAdminCapitalizationWindows(supabase);
              if (!cancelled) setCapWindows(list);
            } catch (err) {
              const e = err as {
                message?: string;
                details?: string;
                hint?: string;
                code?: string;
              };
              console.error('Error cargando ventanas de capitalización:', {
                message: e.message,
                details: e.details,
                hint: e.hint,
                code: e.code,
              });
            }
          }

          // Al admin no le cargamos valor de acción: no aplica.
          if (userRole !== 'admin') {
            if (profile.selected_share_value != null) {
              const val = Number(profile.selected_share_value);
              setSelectedShare(val);
              setSavedShare(val);
            }
            setCanChange(profile.share_value_change_allowed ?? true);

            // Escuchamos cambios en el propio perfil para reflejar en vivo
            // cuando el admin habilita/bloquea el cambio del valor de acción
            // mientras el accionista está en esta pantalla.
            profileChannel = supabase
              .channel(`profile-self-${user.id}`)
              .on(
                'postgres_changes',
                {
                  event: 'UPDATE',
                  schema: 'public',
                  table: 'profiles',
                  filter: `id=eq.${user.id}`,
                },
                (payload) => {
                  if (cancelled) return;
                  const next = payload.new as {
                    share_value_change_allowed?: boolean;
                    selected_share_value?: number | null;
                  };
                  if (typeof next.share_value_change_allowed === 'boolean') {
                    setCanChange((prev) => {
                      // Feedback visible cuando el admin cambió el permiso.
                      if (prev !== next.share_value_change_allowed) {
                        if (next.share_value_change_allowed) {
                          showToast(
                            'success',
                            'El administrador habilitó el cambio de tu valor de acción',
                          );
                        } else {
                          showToast(
                            'info',
                            'El administrador bloqueó el cambio de tu valor de acción',
                          );
                        }
                      }
                      return next.share_value_change_allowed!;
                    });
                  }
                  if (next.selected_share_value != null) {
                    const val = Number(next.selected_share_value);
                    setSavedShare(val);
                    setSelectedShare((prev) => (prev === null ? val : prev));
                  }
                },
              )
              .subscribe();
          }
        } catch (err) {
          console.error('Error cargando perfil:', err);
        }
      }

      const { data: settings } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'allowed_share_values')
        .maybeSingle();

      if (!cancelled && settings?.value) {
        setAllowedShares(settings.value as number[]);
      }


      if (!cancelled) setLoading(false);
    };

    init();

    return () => {
      cancelled = true;
      if (profileChannel) supabase.removeChannel(profileChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Datos personales =====

  // Validación mínima: nombres con longitud razonable, email válido, teléfono
  // y dirección con tope de caracteres, ingresos no negativos.
  const validateProfile = (
    form: ProfileForm,
  ): Partial<Record<keyof ProfileForm, string>> => {
    const errs: Partial<Record<keyof ProfileForm, string>> = {};
    if (form.firstName.trim().length < 2)
      errs.firstName = 'Ingresa al menos 2 caracteres.';
    if (form.firstName.trim().length > 60)
      errs.firstName = 'Máximo 60 caracteres.';
    if (form.lastName.trim().length < 2)
      errs.lastName = 'Ingresa al menos 2 caracteres.';
    if (form.lastName.trim().length > 60)
      errs.lastName = 'Máximo 60 caracteres.';

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(form.email.trim()))
      errs.email = 'Correo electrónico inválido.';

    if (form.phone.trim().length > 25) errs.phone = 'Máximo 25 caracteres.';
    if (form.address.trim().length > 200)
      errs.address = 'Máximo 200 caracteres.';

    if (form.monthlyIncome.trim() !== '') {
      const n = Number(form.monthlyIncome.replace(/[^\d]/g, ''));
      if (!Number.isFinite(n) || n < 0)
        errs.monthlyIncome = 'Debe ser un número mayor o igual a 0.';
      else if (n > 9_999_999_999) errs.monthlyIncome = 'Monto demasiado alto.';
    }

    // Cuenta bancaria: los tres campos son opcionales, pero si se llena uno,
    // exigimos los tres para evitar datos incompletos a la hora de desembolsar.
    const anyBank =
      form.bankName.trim() !== '' ||
      form.bankAccountNumber.trim() !== '' ||
      form.bankAccountType !== '';
    if (anyBank) {
      if (form.bankName.trim().length < 2)
        errs.bankName = 'Indica el nombre del banco.';
      if (form.bankName.trim().length > 60)
        errs.bankName = 'Máximo 60 caracteres.';
      const digits = form.bankAccountNumber.replace(/\D/g, '');
      if (digits.length < 6)
        errs.bankAccountNumber = 'El número debe tener al menos 6 dígitos.';
      else if (digits.length > 20)
        errs.bankAccountNumber = 'Máximo 20 dígitos.';
      if (form.bankAccountType !== 'ahorros' && form.bankAccountType !== 'corriente')
        errs.bankAccountType = 'Selecciona el tipo de cuenta.';
    }

    return errs;
  };

  // ¿Hay algún cambio entre el formulario y lo guardado?
  const profileDirty = (() => {
    const a = profileForm;
    const b = profileSaved;
    return (
      a.firstName.trim() !== b.firstName ||
      a.lastName.trim() !== b.lastName ||
      a.email.trim() !== b.email ||
      a.phone.trim() !== b.phone ||
      a.address.trim() !== b.address ||
      a.monthlyIncome.replace(/[^\d]/g, '') !==
        b.monthlyIncome.replace(/[^\d]/g, '') ||
      a.bankName.trim() !== b.bankName ||
      a.bankAccountNumber.replace(/\D/g, '') !==
        b.bankAccountNumber.replace(/\D/g, '') ||
      a.bankAccountType !== b.bankAccountType
    );
  })();

  const saveProfileInfo = async () => {
    if (!userId) return;
    const errs = validateProfile(profileForm);
    setProfileErrors(errs);
    if (Object.keys(errs).length > 0) {
      showToast('error', 'Revisa los campos marcados.');
      return;
    }

    setProfileSaving(true);
    try {
      const incomeDigits = profileForm.monthlyIncome.replace(/[^\d]/g, '');
      const bankDigits = profileForm.bankAccountNumber.replace(/\D/g, '');
      const anyBank =
        profileForm.bankName.trim() !== '' ||
        bankDigits !== '' ||
        profileForm.bankAccountType !== '';
      const patch = {
        first_name: profileForm.firstName.trim(),
        last_name: profileForm.lastName.trim(),
        phone: profileForm.phone.trim() || null,
        address: profileForm.address.trim() || null,
        monthly_income: incomeDigits === '' ? null : Number(incomeDigits),
        bank_name: anyBank ? profileForm.bankName.trim() : null,
        bank_account_number: anyBank ? bankDigits : null,
        bank_account_type: anyBank
          ? (profileForm.bankAccountType as 'ahorros' | 'corriente')
          : null,
      };

      // 1) Actualizar profiles. RLS solo deja al usuario editar sus propios
      // datos y bloquea role + identity_document.
      await updateProfile(supabase, userId, patch);

      // 2) Correo real — vive en user_metadata.real_email. Si el usuario lo
      // cambió, NO lo aplicamos aquí: mandamos un enlace de verificación al
      // correo nuevo y solo tras confirmar se actualiza el metadata.
      let emailRequested = false;
      const newEmail = profileForm.email.trim();
      if (newEmail !== profileSaved.email) {
        const res = await fetch('/api/profile/request-email-change', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ new_email: newEmail }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          showToast(
            'error',
            body?.error || 'No se pudo iniciar el cambio de correo.',
          );
          setProfileSaving(false);
          return;
        }
        emailRequested = true;
        // Refrescamos el banner de "pendiente" sin esperar a un refetch.
        setPendingEmailChange({
          id: 'local',
          newEmail,
          expiresAt: new Date(
            Date.now() + 24 * 60 * 60 * 1000,
          ).toISOString(),
        });
      }

      // Snapshot nuevo como "guardado". Importante: el email NO se actualiza
      // en el snapshot hasta que el usuario confirme el enlace — así el
      // input sigue mostrando el correo actual y no da falsa sensación de
      // éxito. Mientras tanto, el banner indica la solicitud pendiente.
      setProfileSaved({
        ...profileSaved,
        firstName: patch.first_name,
        lastName: patch.last_name,
        phone: patch.phone ?? '',
        address: patch.address ?? '',
        monthlyIncome:
          patch.monthly_income != null
            ? new Intl.NumberFormat('es-CO').format(patch.monthly_income)
            : '',
        bankName: patch.bank_name ?? '',
        bankAccountNumber: patch.bank_account_number ?? '',
        bankAccountType: (patch.bank_account_type ?? '') as
          | ''
          | 'ahorros'
          | 'corriente',
      });

      // También revertimos el input de correo al último confirmado, para
      // dejar claro que el cambio aún no se aplicó.
      if (emailRequested) {
        setProfileForm((prev) => ({ ...prev, email: profileSaved.email }));
        showToast(
          'success',
          'Te enviamos un enlace de verificación al correo nuevo. Hasta que confirmes, seguirá activo tu correo actual.',
        );
      } else {
        showToast('success', 'Datos guardados.');
      }
    } catch (err) {
      console.error('Error guardando perfil:', err);
      const e = err as { message?: string };
      showToast('error', e.message || 'No se pudo guardar los datos.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleAddShare = () => {
    const val = parseInt(newShare.replace(/\D/g, ''), 10);
    if (!isNaN(val) && !allowedShares.includes(val)) {
      setAllowedShares((prev) => [...prev, val].sort((a, b) => a - b));
    }
    setNewShare('');
  };

  const handleRemoveShare = (valToRemove: number) => {
    setAllowedShares((prev) => prev.filter((v) => v !== valToRemove));
  };

  const saveAdminSettings = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('system_settings')
      .upsert({ key: 'allowed_share_values', value: allowedShares });

    if (error) {
      showToast('error', 'Error al guardar configuración');
    } else {
      showToast('success', 'Configuración actualizada');
    }
    setSaving(false);
  };

  const saveUserShare = async () => {
    if (!userId || !selectedShare) return;
    setSaving(true);

    try {
      await updateProfile(supabase, userId, {
        selected_share_value: selectedShare,
      });
      setSavedShare(selectedShare);
      // El trigger del backend auto-bloquea tras guardar: reflejamos eso
      // en el estado local para que la UI se actualice sin refetch.
      setCanChange(false);
      showToast('success', 'Valor de acción guardado exitosamente');
    } catch (err: unknown) {
      // Supabase devuelve PostgrestError como objeto plano con .message/.hint,
      // no como Error nativo — leemos ambos shapes.
      const errObj = err as { message?: string; hint?: string } | null;
      const message = errObj?.message ?? '';
      const hint = errObj?.hint ?? '';
      const isLocked =
        message.includes('share_value_locked') ||
        hint.includes('share_value_locked') ||
        message.includes('autorizar el cambio');

      if (isLocked) {
        // Silenciamos el console.error: es un flujo esperado (admin bloqueó
        // el cambio justo antes del guardado). La UI ya lo comunica.
        showToast(
          'error',
          'El administrador bloqueó el cambio de tu valor de acción. Vuelve a pedir autorización para modificarlo.',
        );
        // Refrescamos la UI con el nuevo estado bloqueado + restauramos el
        // valor guardado en el select para que no quede desincronizado.
        setCanChange(false);
        setSelectedShare(savedShare);
      } else {
        console.error('Error guardando valor de acción:', err);
        showToast('error', 'Error al guardar tu valor de acción');
      }
    } finally {
      setSaving(false);
    }
  };

  const bulkChangeAllow = async (allow: boolean) => {
    setBulkLoading(allow ? 'allow' : 'revoke');
    try {
      const res = await fetch('/api/admin/share-value-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'all', allow }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        showToast('error', body?.error ?? 'No se pudo aplicar el cambio');
        return;
      }
      const updated = body?.updated ?? 0;
      showToast(
        'success',
        allow
          ? `Cambio habilitado para ${updated} accionista${updated === 1 ? '' : 's'}`
          : `Cambio bloqueado para ${updated} accionista${updated === 1 ? '' : 's'}`,
      );
      // Refrescamos el badge para que muestre el estado nuevo y se
      // deshabilite el botón que ya no aplica.
      await refreshShareChangeStats();
    } catch (err) {
      console.error('Error bulk share-value-unlock:', err);
      showToast('error', 'No se pudo aplicar el cambio');
    } finally {
      setBulkLoading(null);
    }
  };

  const handleOpenGlobalCapWindow = async () => {
    if (!capDeadlineInput) {
      showToast('error', 'Indica una fecha límite.');
      return;
    }
    setCapLoading('opening');
    try {
      await openGlobalCapitalizationWindow(supabase, {
        deadline: capDeadlineInput,
      });
      await refreshCapWindows();
      setCapFormOpen(false);
      setCapDeadlineInput('');
      showToast('success', 'Ventana global de capitalizaciones abierta.');
    } catch (err: unknown) {
      const e = err as { message?: string; hint?: string } | null;
      const hint = e?.hint ?? '';
      const msg = e?.message ?? '';
      if (msg.includes('forbidden')) {
        showToast('error', 'Solo el administrador puede abrir la ventana.');
      } else if (msg.includes('invalid_deadline')) {
        showToast('error', hint || 'La fecha no es válida.');
      } else {
        console.error('Error abriendo ventana:', err);
        showToast('error', 'No se pudo abrir la ventana.');
      }
    } finally {
      setCapLoading(null);
    }
  };

  const handleCloseCapWindow = async (windowId: string) => {
    setCapLoading(windowId);
    try {
      await closeCapitalizationWindowV2(supabase, windowId);
      await refreshCapWindows();
      showToast('success', 'Ventana cerrada.');
    } catch (err) {
      console.error('Error cerrando ventana:', err);
      showToast('error', 'No se pudo cerrar la ventana.');
    } finally {
      setCapLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-[var(--color-text-muted)] text-sm">
        Cargando ajustes...
      </div>
    );
  }

  const isAdmin = role === 'admin';
  // Un accionista puede editar si nunca ha elegido (savedShare === null) o si
  // el admin le permitió cambiar (canChange === true).
  const canUserEditShare = savedShare === null || canChange;
  const userPanelDisabled = !canUserEditShare;

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
      {/* Page header */}
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.025em] leading-[1.15] flex items-center gap-3">
          <Settings
            size={22}
            strokeWidth={1.75}
            className="text-[var(--color-brand)]"
          />
          Ajustes
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1.5">
          Configuración de la plataforma y preferencias personales.
        </p>
      </div>

      {/* Datos personales — visible para admin y accionista. */}
      <PersonalInfoCard
        form={profileForm}
        setForm={setProfileForm}
        errors={profileErrors}
        saving={profileSaving}
        dirty={profileDirty}
        onSave={saveProfileInfo}
        pendingEmailChange={pendingEmailChange}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-[18px]">
        {/* User panel — oculto para el admin (no compra acciones). */}
        {!isAdmin && (
          <Card padding="none" className="flex flex-col overflow-hidden">
            <div className="p-6 flex-1 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3 mb-1">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-[10px] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center">
                    <Landmark size={18} strokeWidth={1.75} />
                  </div>
                  <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-text)]">
                    Tu valor de acción
                  </h2>
                </div>
                {savedShare !== null &&
                  (canChange ? (
                    <Badge tone="success" className="shrink-0">
                      <Unlock size={11} strokeWidth={1.75} />
                      Cambio habilitado
                    </Badge>
                  ) : (
                    <Badge tone="neutral" className="shrink-0">
                      <Lock size={11} strokeWidth={1.75} />
                      Bloqueado
                    </Badge>
                  ))}
              </div>
              <p className="text-[var(--color-text-muted)] text-[13px] leading-[1.55]">
                Selecciona el monto fijo que aportarás mensualmente como acción dentro
                de la plataforma. Este valor formará parte de tu capital acumulado.
                <br />
                <span className="text-[12px] text-[var(--color-text-subtle)]">
                  Una vez guardes tu selección, no podrás cambiarla sin autorización
                  del administrador.
                </span>
              </p>

              <div className="space-y-3 mt-2">
                <label className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-[0.12em]">
                  Valor de acción mensual
                </label>

                <div className="relative">
                  <select
                    value={selectedShare ?? ''}
                    disabled={userPanelDisabled}
                    onChange={(e) =>
                      setSelectedShare(e.target.value ? Number(e.target.value) : null)
                    }
                    className="w-full appearance-none h-11 px-3.5 pr-10 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm font-medium transition-colors focus:outline-none focus:border-[var(--color-brand)] focus:ring-4 focus:ring-[var(--color-ring)] cursor-pointer hover:border-[var(--color-border-strong)] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="" disabled>
                      — Selecciona un valor —
                    </option>
                    {allowedShares.map((val) => (
                      <option key={val} value={val}>
                        {cop(val)} / mes
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={16}
                    strokeWidth={1.75}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none"
                  />
                </div>

                {allowedShares.length === 0 && (
                  <p className="text-sm text-[var(--color-text-muted)] italic">
                    El administrador aún no ha configurado valores disponibles.
                  </p>
                )}

                {savedShare !== null && (
                  <div className="flex items-center gap-2 mt-2 px-3 py-2.5 rounded-[10px] bg-[var(--color-success-soft)] text-[var(--color-success)]">
                    <CheckCircle2 size={15} strokeWidth={1.75} className="shrink-0" />
                    <span className="text-[13px] font-semibold">
                      Valor guardado actualmente: {cop(savedShare)}
                    </span>
                  </div>
                )}

                {userPanelDisabled && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-[10px] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] text-[12.5px] leading-[1.5]">
                    <Lock size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
                    <span>
                      Tu valor de acción está bloqueado. Pídele al administrador que
                      autorice el cambio si necesitas modificarlo.
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="p-4 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
              <Button
                className="w-full"
                onClick={saveUserShare}
                disabled={
                  saving ||
                  !selectedShare ||
                  selectedShare === savedShare ||
                  userPanelDisabled
                }
              >
                <Save size={15} strokeWidth={1.75} />
                {saving
                  ? 'Guardando...'
                  : selectedShare === savedShare
                    ? 'Sin cambios'
                    : 'Guardar preferencia'}
              </Button>
            </div>
          </Card>
        )}

        {/* Admin panel */}
        {isAdmin && (
          <>
            <Card padding="none" className="flex flex-col overflow-hidden">
              <div className="p-6 flex-1 flex flex-col gap-4">
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-10 h-10 rounded-[10px] bg-[var(--color-info-soft)] text-[var(--color-info)] flex items-center justify-center">
                    <Settings size={18} strokeWidth={1.75} />
                  </div>
                  <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-text)]">
                    Configuración global
                  </h2>
                </div>
                <p className="text-[var(--color-text-muted)] text-[13px] leading-[1.55]">
                  Administra los valores fijos permitidos para las acciones de todos
                  los miembros. Los montos que agregues aquí estarán disponibles en los
                  perfiles.
                </p>

                <div className="space-y-4 mt-1">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Input
                        type="number"
                        placeholder="Monto (Ej. 25000)"
                        value={newShare}
                        onChange={(e) => setNewShare(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddShare()}
                      />
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleAddShare}
                      className="shrink-0"
                      size="md"
                    >
                      <Plus size={15} strokeWidth={1.75} />
                      Añadir
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {allowedShares.map((val) => (
                      <Badge key={val} tone="brand" className="pr-1.5">
                        {cop(val)}
                        <button
                          type="button"
                          onClick={() => handleRemoveShare(val)}
                          className="ml-1 p-0.5 rounded-full hover:bg-[var(--color-brand)]/10 transition-colors"
                          aria-label={`Quitar ${cop(val)}`}
                        >
                          <X size={12} strokeWidth={2} />
                        </button>
                      </Badge>
                    ))}
                    {allowedShares.length === 0 && (
                      <span className="text-sm text-[var(--color-text-muted)] italic">
                        No hay valores configurados.
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="p-4 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={saveAdminSettings}
                  disabled={saving}
                >
                  <Save size={15} strokeWidth={1.75} />
                  {saving ? 'Aplicando...' : 'Aplicar cambios globales'}
                </Button>
              </div>
            </Card>

            {/* Bulk: permitir o revocar cambio de valor a todos los accionistas */}
            <Card padding="none" className="flex flex-col overflow-hidden">
              <div className="p-6 flex-1 flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-[10px] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center">
                      <Users size={18} strokeWidth={1.75} />
                    </div>
                    <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-text)]">
                      Cambio de valor de acción
                    </h2>
                  </div>
                  {(() => {
                    // Badge de estado actual. Tres casos:
                    //   - Sin accionistas registrados → no mostramos nada.
                    //   - Todos habilitados       → verde "Habilitado".
                    //   - Todos bloqueados        → neutro "Bloqueado".
                    //   - Mixto                   → warn "N de M habilitados".
                    if (!shareChangeStats || shareChangeStats.total === 0) {
                      return null;
                    }
                    const { enabled, total } = shareChangeStats;
                    if (enabled === total) {
                      return (
                        <Badge tone="success" dot>
                          Habilitado
                        </Badge>
                      );
                    }
                    if (enabled === 0) {
                      return (
                        <Badge tone="neutral" dot>
                          Bloqueado
                        </Badge>
                      );
                    }
                    return (
                      <Badge tone="warn" dot>
                        {enabled} de {total} habilitados
                      </Badge>
                    );
                  })()}
                </div>
                <p className="text-[var(--color-text-muted)] text-[13px] leading-[1.55]">
                  Por defecto cada accionista puede elegir su valor de acción una
                  sola vez. Si quieres reabrir el cambio para todos (por ejemplo,
                  cuando ajustas los montos globales), hazlo aquí. También puedes
                  permitir o revocar uno por uno desde el directorio de accionistas.
                </p>

                {(() => {
                  // Derivamos los flags de UI a partir del conteo. Si aún no
                  // tenemos los datos (primer render), los botones quedan
                  // activos pero sin saber el estado.
                  const total = shareChangeStats?.total ?? 0;
                  const enabled = shareChangeStats?.enabled ?? 0;
                  const allEnabled = total > 0 && enabled === total;
                  const allBlocked = total > 0 && enabled === 0;

                  return (
                    <div className="flex flex-col gap-2 mt-1">
                      <Button
                        className="w-full"
                        onClick={() => bulkChangeAllow(true)}
                        disabled={bulkLoading !== null || allEnabled}
                        title={
                          allEnabled
                            ? 'Todos los accionistas ya lo tienen habilitado'
                            : undefined
                        }
                      >
                        <Unlock size={15} strokeWidth={1.75} />
                        {bulkLoading === 'allow'
                          ? 'Habilitando...'
                          : allEnabled
                            ? 'Ya habilitado para todos'
                            : 'Permitir cambio a todos los accionistas'}
                      </Button>
                      <Button
                        className="w-full"
                        variant="secondary"
                        onClick={() => bulkChangeAllow(false)}
                        disabled={bulkLoading !== null || allBlocked}
                        title={
                          allBlocked
                            ? 'Ningún accionista lo tiene habilitado'
                            : undefined
                        }
                      >
                        <Lock size={15} strokeWidth={1.75} />
                        {bulkLoading === 'revoke'
                          ? 'Bloqueando...'
                          : allBlocked
                            ? 'Ya bloqueado para todos'
                            : 'Bloquear cambio a todos los accionistas'}
                      </Button>
                    </div>
                  );
                })()}
              </div>
            </Card>

            {/* Capitalizaciones (solo admin). Ocupa el ancho completo. */}
            <div className="md:col-span-2">
              <CapitalizationAdminCard
                windows={capWindows}
                formOpen={capFormOpen}
                setFormOpen={setCapFormOpen}
                deadlineInput={capDeadlineInput}
                setDeadlineInput={setCapDeadlineInput}
                loading={capLoading}
                onOpenGlobal={handleOpenGlobalCapWindow}
                onClose={handleCloseCapWindow}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Card de capitalizaciones (admin) — modelo v2
//
// Acá solo gestionamos la ventana GLOBAL (la que aplica a todos los que
// no tengan ventana individual). Las ventanas individuales se manejan
// desde /dashboard/miembros (botón por accionista).
//
// Renderiza:
//   - El estado actual de la global (abierta / no abierta).
//   - Form para abrir nueva global (solo deadline; sin monto).
//   - Lista de ventanas individuales activas (informativa, con botón
//     cerrar para que el admin pueda revocar desde acá si quiere).
// =============================================================================
function CapitalizationAdminCard({
  windows,
  formOpen,
  setFormOpen,
  deadlineInput,
  setDeadlineInput,
  loading,
  onOpenGlobal,
  onClose,
}: {
  windows: AdminCapWindow[] | null;
  formOpen: boolean;
  setFormOpen: (b: boolean) => void;
  deadlineInput: string;
  setDeadlineInput: (v: string) => void;
  loading: 'opening' | 'closing' | string | null;
  onOpenGlobal: () => void;
  onClose: (windowId: string) => void;
}) {
  if (windows === null) {
    return (
      <Card padding="lg">
        <span className="text-sm text-[var(--color-text-muted)]">
          Cargando capitalizaciones…
        </span>
      </Card>
    );
  }

  const globalWindow = windows.find((w) => w.scope === 'global') ?? null;
  const userWindows = windows.filter((w) => w.scope === 'user');
  const isGlobalOpen = globalWindow !== null;

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="p-6 flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-[10px] flex items-center justify-center ${
              isGlobalOpen
                ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]'
                : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]'
            }`}
          >
            <TrendingUp size={18} strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[15px] font-semibold tracking-tight">
                Capitalización global
              </h2>
              {isGlobalOpen ? (
                <Badge tone="success">
                  <PlayCircle size={11} strokeWidth={1.75} />
                  Abierta
                </Badge>
              ) : (
                <Badge tone="neutral">
                  <PauseCircle size={11} strokeWidth={1.75} />
                  Cerrada
                </Badge>
              )}
            </div>
            <p className="text-[var(--color-text-muted)] text-[13px] leading-[1.55] mt-1">
              Aplica a todos los accionistas que NO tengan una ventana
              individual abierta. Se cierra automáticamente al pasar la fecha
              límite. Sin tope de monto.
            </p>
          </div>
        </div>

        {/* Estado global actual */}
        {globalWindow && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <InfoTile
              icon={CalendarClock}
              label="Fecha límite"
              value={formatDateIso(globalWindow.deadline)}
            />
            <InfoTile
              icon={PlayCircle}
              label="Abierta desde"
              value={formatIsoInstant(globalWindow.opened_at)}
            />
          </div>
        )}

        {/* Formulario de apertura — solo deadline */}
        {formOpen && (
          <div className="flex flex-col gap-3 p-4 rounded-[12px] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)]/50">
            <div>
              <label className="text-[11px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase mb-1 block">
                Fecha límite
              </label>
              <Input
                type="date"
                value={deadlineInput}
                onChange={(e) => setDeadlineInput(e.target.value)}
              />
              <p className="text-[11px] text-[var(--color-text-subtle)] mt-1.5">
                Si ya hay una global abierta, se reemplaza por esta nueva.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="md"
                onClick={onOpenGlobal}
                disabled={loading !== null}
              >
                <PlayCircle size={15} strokeWidth={1.75} />
                {loading === 'opening' ? 'Abriendo...' : 'Abrir global'}
              </Button>
              <Button
                size="md"
                variant="secondary"
                onClick={() => setFormOpen(false)}
                disabled={loading !== null}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Lista de ventanas individuales activas */}
        {userWindows.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold text-[var(--color-text-subtle)] tracking-[0.12em] uppercase mb-1">
              Ventanas individuales activas ({userWindows.length})
            </div>
            <div className="flex flex-col divide-y divide-[var(--color-border)] rounded-[10px] border border-[var(--color-border)] overflow-hidden">
              {userWindows.map((w) => {
                const closing = loading === w.id;
                return (
                  <div
                    key={w.id}
                    className="flex items-center gap-3 px-3.5 py-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold tracking-tight truncate">
                        {w.user_name ?? 'Accionista'}
                        {w.user_document && (
                          <span className="text-[var(--color-text-subtle)] font-normal ml-2">
                            · CC {w.user_document}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                        Cupo {cop(w.used_amount)} de {cop(w.max_amount ?? 0)} ·
                        Cierra {formatDateIso(w.deadline)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onClose(w.id)}
                      disabled={loading !== null}
                    >
                      <PauseCircle size={13} strokeWidth={1.75} />
                      {closing ? 'Cerrando…' : 'Cerrar'}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="p-4 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)] flex flex-col sm:flex-row gap-2">
        {isGlobalOpen ? (
          <Button
            className="w-full sm:w-auto"
            variant="secondary"
            onClick={() => globalWindow && onClose(globalWindow.id)}
            disabled={loading !== null || !globalWindow}
          >
            <PauseCircle size={15} strokeWidth={1.75} />
            {loading === globalWindow?.id ? 'Cerrando...' : 'Cerrar global'}
          </Button>
        ) : null}
        {!formOpen && (
          <Button
            className="w-full sm:w-auto"
            onClick={() => {
              setFormOpen(true);
              setDeadlineInput('');
            }}
            disabled={loading !== null}
          >
            <PlayCircle size={15} strokeWidth={1.75} />
            {isGlobalOpen ? 'Reemplazar global' : 'Abrir global'}
          </Button>
        )}
      </div>
    </Card>
  );
}

function InfoTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 p-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">
        <Icon size={11} strokeWidth={1.75} />
        {label}
      </div>
      <div className="text-[14px] font-semibold tabular tracking-tight">
        {value}
      </div>
    </div>
  );
}

// timestamptz ISO → '14 abr 2026, 09:30'
function formatIsoInstant(iso: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('es-CO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Bogota',
    }).format(d);
  } catch {
    return iso;
  }
}

// 'YYYY-MM-DD' → '14 abr 2026'
function formatDateIso(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = [
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
  return `${d} ${months[m - 1] ?? ''} ${y}`;
}

// =============================================================================
// Card de datos personales
// =============================================================================
type PersonalInfoForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  monthlyIncome: string;
  identityDocument: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountType: '' | 'ahorros' | 'corriente';
};

function PersonalInfoCard({
  form,
  setForm,
  errors,
  saving,
  dirty,
  onSave,
  pendingEmailChange,
}: {
  form: PersonalInfoForm;
  setForm: React.Dispatch<React.SetStateAction<PersonalInfoForm>>;
  errors: Partial<Record<keyof PersonalInfoForm, string>>;
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
  pendingEmailChange: {
    id: string;
    newEmail: string;
    expiresAt: string;
  } | null;
}) {
  const update = <K extends keyof PersonalInfoForm>(
    key: K,
    value: PersonalInfoForm[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="p-6 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[10px] bg-[var(--color-info-soft)] text-[var(--color-info)] flex items-center justify-center">
            <UserCog size={18} strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-text)]">
              Datos personales
            </h2>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
              Mantén tu información actualizada. El documento de identidad no se
              puede modificar desde aquí — contacta al administrador si
              necesitas corregirlo.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Nombres"
            value={form.firstName}
            onChange={(e) => update('firstName', e.target.value)}
            placeholder="Ej. Juan Camilo"
            error={errors.firstName}
            maxLength={60}
          />
          <Input
            label="Apellidos"
            value={form.lastName}
            onChange={(e) => update('lastName', e.target.value)}
            placeholder="Ej. Ramírez López"
            error={errors.lastName}
            maxLength={60}
          />
          <div>
            <Input
              icon={Mail}
              label="Correo electrónico"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              placeholder="tucorreo@ejemplo.com"
              error={errors.email}
            />
            {pendingEmailChange && (
              <div className="mt-2 flex items-start gap-2 px-3 py-2.5 rounded-[10px] bg-[var(--color-warning-soft,var(--color-info-soft))] text-[var(--color-text)] text-[12px] leading-[1.5] border border-[var(--color-border)]">
                <CalendarClock
                  size={13}
                  strokeWidth={2}
                  className="mt-0.5 shrink-0 text-[var(--color-info)]"
                />
                <span>
                  Hay una solicitud pendiente para cambiar tu correo a{' '}
                  <strong>{pendingEmailChange.newEmail}</strong>. Revisa tu
                  bandeja y haz clic en el enlace de verificación. El enlace
                  expira el {formatIsoInstant(pendingEmailChange.expiresAt)}.
                </span>
              </div>
            )}
          </div>
          <Input
            icon={Phone}
            label="Teléfono"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => update('phone', e.target.value)}
            placeholder="Ej. 300 123 4567"
            error={errors.phone}
            maxLength={25}
          />
          <div className="md:col-span-2">
            <Input
              icon={MapPin}
              label="Dirección"
              value={form.address}
              onChange={(e) => update('address', e.target.value)}
              placeholder="Calle, carrera, barrio, ciudad"
              error={errors.address}
              maxLength={200}
            />
          </div>
          <Input
            icon={Wallet}
            label="Ingresos mensuales (COP)"
            inputMode="numeric"
            value={form.monthlyIncome}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^\d]/g, '');
              if (digits === '') {
                update('monthlyIncome', '');
              } else {
                update(
                  'monthlyIncome',
                  new Intl.NumberFormat('es-CO').format(Number(digits)),
                );
              }
            }}
            placeholder="Ej. 3.000.000"
            error={errors.monthlyIncome}
          />
          <Input
            icon={IdCard}
            label="Documento de identidad"
            value={form.identityDocument}
            readOnly
            disabled
            title="Solo el administrador puede corregir este campo"
          />
        </div>

        {/* Cuenta bancaria: datos para el desembolso de préstamos. */}
        <div className="mt-2 pt-5 border-t border-[var(--color-border)]">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-[10px] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center">
              <Landmark size={16} strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold tracking-tight text-[var(--color-text)]">
                Cuenta bancaria
              </h3>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                Donde te consignaremos el dinero cuando solicites un préstamo.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              icon={Landmark}
              label="Banco"
              value={form.bankName}
              onChange={(e) => update('bankName', e.target.value)}
              placeholder="Ej. Bancolombia"
              error={errors.bankName}
              maxLength={60}
            />
            <Input
              label="Número de cuenta"
              inputMode="numeric"
              value={form.bankAccountNumber}
              onChange={(e) =>
                update(
                  'bankAccountNumber',
                  e.target.value.replace(/\D/g, '').slice(0, 20),
                )
              }
              placeholder="Solo números"
              error={errors.bankAccountNumber}
            />
            <div>
              <label className="block text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-[0.12em] mb-1.5">
                Tipo de cuenta
              </label>
              <div className="relative">
                <select
                  value={form.bankAccountType}
                  onChange={(e) =>
                    update(
                      'bankAccountType',
                      e.target.value as '' | 'ahorros' | 'corriente',
                    )
                  }
                  className="w-full appearance-none h-11 px-3.5 pr-10 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm font-medium transition-colors focus:outline-none focus:border-[var(--color-brand)] focus:ring-4 focus:ring-[var(--color-ring)] cursor-pointer hover:border-[var(--color-border-strong)]"
                >
                  <option value="">— Selecciona —</option>
                  <option value="ahorros">Ahorros</option>
                  <option value="corriente">Corriente</option>
                </select>
                <ChevronDown
                  size={16}
                  strokeWidth={1.75}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none"
                />
              </div>
              {errors.bankAccountType && (
                <p className="text-[12px] text-[var(--color-danger)] mt-1">
                  {errors.bankAccountType}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Nota sobre el correo: aclaramos que es el correo de contacto
            (no el de login, que se hace con la cédula). */}
        <div className="flex items-start gap-2 text-[12px] text-[var(--color-text-muted)] px-0.5 leading-[1.5]">
          <Mail
            size={13}
            strokeWidth={2}
            className="mt-0.5 shrink-0 text-[var(--color-text-subtle)]"
          />
          <span>
            Este es tu correo de contacto (donde llegan las notificaciones y
            los enlaces para restablecer la contraseña). Tu inicio de sesión
            seguirá siendo con tu documento de identidad.
          </span>
        </div>
      </div>

      <div className="p-4 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)] flex items-center justify-end">
        <Button onClick={onSave} disabled={saving || !dirty}>
          <Save size={15} strokeWidth={1.75} />
          {saving ? 'Guardando...' : dirty ? 'Guardar cambios' : 'Sin cambios'}
        </Button>
      </div>
    </Card>
  );
}

