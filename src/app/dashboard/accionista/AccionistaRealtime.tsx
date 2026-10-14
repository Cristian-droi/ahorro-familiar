'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

export function AccionistaRealtime({ userId }: { userId: string }) {
  const router = useRouter();

  useEffect(() => {
    if (!userId) return;

    // Escuchar cambios en recibos de este accionista y en préstamos/votos
    const channel = supabase
      .channel(`accionista-dashboard-live-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'receipts',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          router.refresh();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'loans',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          router.refresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, router]);

  return null;
}
