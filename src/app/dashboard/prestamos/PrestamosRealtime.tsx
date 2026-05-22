'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

export function PrestamosRealtime({ userId }: { userId: string }) {
  const router = useRouter();

  useEffect(() => {
    if (!userId) return;

    const ch = supabase
      .channel(`accionista-prestamos-live-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'loans' },
        () => router.refresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'loan_votes' },
        () => router.refresh()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, router]);

  return null;
}
