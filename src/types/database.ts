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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
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
      receipt_items: {
        Row: {
          amount: number
          auto_generated: boolean
          concept: Database["public"]["Enums"]["receipt_concept"]
          created_at: string
          id: string
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
          receipt_id?: string
          share_count?: number | null
          target_month?: string
          unit_value?: number | null
        }
        Relationships: [
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
      is_admin: { Args: never; Returns: boolean }
      get_capitalization_window_state: { Args: never; Returns: Json }
      open_capitalization_window: {
        Args: { p_target_amount: number; p_deadline: string }
        Returns: Json
      }
      close_capitalization_window: { Args: never; Returns: Json }
    }
    Enums: {
      bank_account_type: "ahorros" | "corriente"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      bank_account_type: ["ahorros", "corriente"],
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
