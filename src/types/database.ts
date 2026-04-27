export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      capitalization_windows: {
        Row: {
          closed_at: string | null
          closed_reason: string | null
          created_at: string
          deadline: string
          id: string
          max_amount: number | null
          opened_at: string
          opened_by: string | null
          scope: string
          user_id: string | null
        }
        Insert: {
          closed_at?: string | null
          closed_reason?: string | null
          created_at?: string
          deadline: string
          id?: string
          max_amount?: number | null
          opened_at?: string
          opened_by?: string | null
          scope: string
          user_id?: string | null
        }
        Update: {
          closed_at?: string | null
          closed_reason?: string | null
          created_at?: string
          deadline?: string
          id?: string
          max_amount?: number | null
          opened_at?: string
          opened_by?: string | null
          scope?: string
          user_id?: string | null
        }
        Relationships: []
      }
      email_change_requests: {
        Row: {
          canceled_at: string | null
          confirmed_at: string | null
          created_at: string
          expires_at: string
          id: string
          new_email: string
          token: string
          user_id: string
        }
        Insert: {
          canceled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          new_email: string
          token: string
          user_id: string
        }
        Update: {
          canceled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          new_email?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      loan_payment_plan_items: {
        Row: {
          capital_amount: number
          created_at: string
          due_date: string
          estimated_balance_after: number
          estimated_interest: number
          id: string
          loan_id: string
          month_number: number
        }
        Insert: {
          capital_amount?: number
          created_at?: string
          due_date: string
          estimated_balance_after?: number
          estimated_interest?: number
          id?: string
          loan_id: string
          month_number: number
        }
        Update: {
          capital_amount?: number
          created_at?: string
          due_date?: string
          estimated_balance_after?: number
          estimated_interest?: number
          id?: string
          loan_id?: string
          month_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "loan_payment_plan_items_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_votes: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          loan_id: string
          vote: Database["public"]["Enums"]["loan_vote_value"]
          voted_at: string
          voter_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          loan_id: string
          vote: Database["public"]["Enums"]["loan_vote_value"]
          voted_at?: string
          voter_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          loan_id?: string
          vote?: Database["public"]["Enums"]["loan_vote_value"]
          voted_at?: string
          voter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_votes_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_votes_voter_id_fkey"
            columns: ["voter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      loans: {
        Row: {
          admin_notes: string | null
          borrower_seen_status_at: string | null
          created_at: string
          disbursed_amount: number | null
          disbursed_at: string | null
          disbursement_number: string | null
          disbursement_proof_path: string | null
          four_per_thousand: number
          id: string
          interest_rate: number
          last_interest_payment_date: string | null
          loan_shares_amount: number
          loan_shares_count: number
          loan_shares_paid_upfront: boolean
          outstanding_balance: number
          payment_plan_months: number | null
          plan_rejection_reason: string | null
          plan_status: string | null
          rejection_reason: string | null
          requested_amount: number
          status: Database["public"]["Enums"]["loan_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          borrower_seen_status_at?: string | null
          created_at?: string
          disbursed_amount?: number | null
          disbursed_at?: string | null
          disbursement_number?: string | null
          disbursement_proof_path?: string | null
          four_per_thousand?: number
          id?: string
          interest_rate?: number
          last_interest_payment_date?: string | null
          loan_shares_amount?: number
          loan_shares_count?: number
          loan_shares_paid_upfront?: boolean
          outstanding_balance?: number
          payment_plan_months?: number | null
          plan_rejection_reason?: string | null
          plan_status?: string | null
          rejection_reason?: string | null
          requested_amount: number
          status?: Database["public"]["Enums"]["loan_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          borrower_seen_status_at?: string | null
          created_at?: string
          disbursed_amount?: number | null
          disbursed_at?: string | null
          disbursement_number?: string | null
          disbursement_proof_path?: string | null
          four_per_thousand?: number
          id?: string
          interest_rate?: number
          last_interest_payment_date?: string | null
          loan_shares_amount?: number
          loan_shares_count?: number
          loan_shares_paid_upfront?: boolean
          outstanding_balance?: number
          payment_plan_months?: number | null
          plan_rejection_reason?: string | null
          plan_status?: string | null
          rejection_reason?: string | null
          requested_amount?: number
          status?: Database["public"]["Enums"]["loan_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loans_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_requests: {
        Row: {
          address: string
          created_at: string
          email: string
          first_name: string
          id: string
          identity_document: string
          last_name: string
          monthly_income: number
          phone: string
          rejection_reason: string | null
          status: Database["public"]["Enums"]["request_status"]
          updated_at: string
        }
        Insert: {
          address: string
          created_at?: string
          email: string
          first_name: string
          id?: string
          identity_document: string
          last_name: string
          monthly_income: number
          phone: string
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
        }
        Update: {
          address?: string
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          identity_document?: string
          last_name?: string
          monthly_income?: number
          phone?: string
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string | null
          bank_account_number: string | null
          bank_account_type:
            | Database["public"]["Enums"]["bank_account_type"]
            | null
          bank_name: string | null
          created_at: string
          first_name: string
          id: string
          identity_document: string
          last_name: string
          monthly_income: number | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          selected_share_value: number | null
          share_value_change_allowed: boolean
          updated_at: string
        }
        Insert: {
          address?: string | null
          bank_account_number?: string | null
          bank_account_type?:
            | Database["public"]["Enums"]["bank_account_type"]
            | null
          bank_name?: string | null
          created_at?: string
          first_name: string
          id: string
          identity_document: string
          last_name: string
          monthly_income?: number | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          selected_share_value?: number | null
          share_value_change_allowed?: boolean
          updated_at?: string
        }
        Update: {
          address?: string | null
          bank_account_number?: string | null
          bank_account_type?:
            | Database["public"]["Enums"]["bank_account_type"]
            | null
          bank_name?: string | null
          created_at?: string
          first_name?: string
          id?: string
          identity_document?: string
          last_name?: string
          monthly_income?: number | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          selected_share_value?: number | null
          share_value_change_allowed?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      receipt_items: {
        Row: {
          amount: number
          auto_generated: boolean
          concept: Database["public"]["Enums"]["receipt_concept"]
          created_at: string
          id: string
          loan_id: string | null
          receipt_id: string
          share_count: number | null
          target_month: string
          unit_value: number | null
        }
        Insert: {
          amount: number
          auto_generated?: boolean
          concept: Database["public"]["Enums"]["receipt_concept"]
          created_at?: string
          id?: string
          loan_id?: string | null
          receipt_id: string
          share_count?: number | null
          target_month: string
          unit_value?: number | null
        }
        Update: {
          amount?: number
          auto_generated?: boolean
          concept?: Database["public"]["Enums"]["receipt_concept"]
          created_at?: string
          id?: string
          loan_id?: string | null
          receipt_id?: string
          share_count?: number | null
          target_month?: string
          unit_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_items_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_items_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          created_at: string
          id: string
          payment_proof_path: string | null
          receipt_number: string | null
          rejection_note: string | null
          rejection_reason:
            | Database["public"]["Enums"]["receipt_rejection_reason"]
            | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["receipt_status"]
          submitted_at: string
          total_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          payment_proof_path?: string | null
          receipt_number?: string | null
          rejection_note?: string | null
          rejection_reason?:
            | Database["public"]["Enums"]["receipt_rejection_reason"]
            | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["receipt_status"]
          submitted_at?: string
          total_amount?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          payment_proof_path?: string | null
          receipt_number?: string | null
          rejection_note?: string | null
          rejection_reason?:
            | Database["public"]["Enums"]["receipt_rejection_reason"]
            | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["receipt_status"]
          submitted_at?: string
          total_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          key: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _test_anon_insert: {
        Args: never
        Returns: {
          inserted_id: string
          message: string
          sqlstate_code: string
          status: string
        }[]
      }
      close_capitalization_window: { Args: never; Returns: Json }
      close_capitalization_window_v2: {
        Args: { p_window_id: string }
        Returns: undefined
      }
      count_active_shareholders: { Args: never; Returns: number }
      get_capitalization_window_state: { Args: never; Returns: Json }
      get_capitalization_windows_admin: {
        Args: never
        Returns: {
          deadline: string
          id: string
          max_amount: number
          opened_at: string
          remaining: number
          scope: string
          used_amount: number
          user_document: string
          user_id: string
          user_name: string
        }[]
      }
      get_cash_balance: { Args: never; Returns: number }
      get_my_capitalization_state: { Args: never; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
      mark_my_loans_status_seen: { Args: never; Returns: number }
      open_capitalization_window: {
        Args: { p_deadline: string; p_target_amount: number }
        Returns: Json
      }
      open_capitalization_window_v2: {
        Args: {
          p_deadline: string
          p_max_amount: number
          p_scope: string
          p_user_id: string
        }
        Returns: string
      }
    }
    Enums: {
      bank_account_type: "ahorros" | "corriente"
      loan_status:
        | "draft"
        | "pending_review"
        | "pending_shareholder_vote"
        | "pending_disbursement"
        | "active"
        | "paid"
        | "rejected_by_admin"
        | "rejected_by_shareholders"
      loan_vote_value: "approved" | "rejected"
      receipt_concept:
        | "acciones"
        | "acciones_prestamo"
        | "pago_capital"
        | "pago_intereses"
        | "capitalizacion"
        | "multa_acciones"
        | "otros"
      receipt_rejection_reason: "amount_mismatch" | "payment_not_received"
      receipt_status: "pending" | "approved" | "rejected"
      request_status: "pending" | "approved" | "rejected"
      user_role: "admin" | "accionista"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      bank_account_type: ["ahorros", "corriente"],
      loan_status: [
        "draft",
        "pending_review",
        "pending_shareholder_vote",
        "pending_disbursement",
        "active",
        "paid",
        "rejected_by_admin",
        "rejected_by_shareholders",
      ],
      loan_vote_value: ["approved", "rejected"],
      receipt_concept: [
        "acciones",
        "acciones_prestamo",
        "pago_capital",
        "pago_intereses",
        "capitalizacion",
        "multa_acciones",
        "otros",
      ],
      receipt_rejection_reason: ["amount_mismatch", "payment_not_received"],
      receipt_status: ["pending", "approved", "rejected"],
      request_status: ["pending", "approved", "rejected"],
      user_role: ["admin", "accionista"],
    },
  },
} as const
