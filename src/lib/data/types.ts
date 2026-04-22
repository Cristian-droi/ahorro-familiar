import type { SupabaseClient as BaseSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// Un cliente Supabase tipado con nuestro schema, sin importar si viene del
// browser, de Server Components o del service role.
export type TypedSupabaseClient = BaseSupabaseClient<Database>;

export type Tables = Database['public']['Tables'];
export type Enums = Database['public']['Enums'];

export type MembershipRequestRow = Tables['membership_requests']['Row'];
export type MembershipRequestInsert = Tables['membership_requests']['Insert'];
export type ProfileRow = Tables['profiles']['Row'];
export type ProfileInsert = Tables['profiles']['Insert'];
export type ProfileUpdate = Tables['profiles']['Update'];

export type ReceiptRow = Tables['receipts']['Row'];
export type ReceiptInsert = Tables['receipts']['Insert'];
export type ReceiptUpdate = Tables['receipts']['Update'];

export type ReceiptItemRow = Tables['receipt_items']['Row'];
export type ReceiptItemInsert = Tables['receipt_items']['Insert'];
export type ReceiptItemUpdate = Tables['receipt_items']['Update'];

export type ReceiptStatus = Enums['receipt_status'];
export type ReceiptConcept = Enums['receipt_concept'];
export type ReceiptRejectionReason = Enums['receipt_rejection_reason'];
