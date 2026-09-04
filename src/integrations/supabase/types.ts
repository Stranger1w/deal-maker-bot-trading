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
      audit_events: {
        Row: {
          action: string
          actor: string
          created_at: string
          details: Json
          entity: string
          entity_id: string | null
          id: string
        }
        Insert: {
          action: string
          actor?: string
          created_at?: string
          details?: Json
          entity: string
          entity_id?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor?: string
          created_at?: string
          details?: Json
          entity?: string
          entity_id?: string | null
          id?: string
        }
        Relationships: []
      }
      automation_settings: {
        Row: {
          allow_real_trading: boolean
          engine_enabled: boolean
          engine_status: string
          global_max_daily_loss: number
          global_max_drawdown_pct: number
          id: string
          kill_switch: boolean
          last_error: string | null
          last_heartbeat_at: string | null
          tick_interval_seconds: number
          updated_at: string
        }
        Insert: {
          allow_real_trading?: boolean
          engine_enabled?: boolean
          engine_status?: string
          global_max_daily_loss?: number
          global_max_drawdown_pct?: number
          id?: string
          kill_switch?: boolean
          last_error?: string | null
          last_heartbeat_at?: string | null
          tick_interval_seconds?: number
          updated_at?: string
        }
        Update: {
          allow_real_trading?: boolean
          engine_enabled?: boolean
          engine_status?: string
          global_max_daily_loss?: number
          global_max_drawdown_pct?: number
          id?: string
          kill_switch?: boolean
          last_error?: string | null
          last_heartbeat_at?: string | null
          tick_interval_seconds?: number
          updated_at?: string
        }
        Relationships: []
      }
      binance_credentials: {
        Row: {
          api_key_cipher: string
          api_key_last4: string
          api_secret_cipher: string
          api_secret_last4: string
          connection_status: string
          created_at: string
          id: string
          last_tested_at: string | null
          market_mode: string
          updated_at: string
        }
        Insert: {
          api_key_cipher: string
          api_key_last4: string
          api_secret_cipher: string
          api_secret_last4: string
          connection_status?: string
          created_at?: string
          id?: string
          last_tested_at?: string | null
          market_mode?: string
          updated_at?: string
        }
        Update: {
          api_key_cipher?: string
          api_key_last4?: string
          api_secret_cipher?: string
          api_secret_last4?: string
          connection_status?: string
          created_at?: string
          id?: string
          last_tested_at?: string | null
          market_mode?: string
          updated_at?: string
        }
        Relationships: []
      }
      bot_executions: {
        Row: {
          attempts: number
          bot_id: string | null
          bot_name: string
          created_at: string
          error: string | null
          id: string
          idempotency_key: string
          mode: string
          pnl: number
          price: number
          quantity: number
          side: string
          status: string
          symbol: string
        }
        Insert: {
          attempts?: number
          bot_id?: string | null
          bot_name: string
          created_at?: string
          error?: string | null
          id?: string
          idempotency_key: string
          mode?: string
          pnl?: number
          price?: number
          quantity?: number
          side: string
          status?: string
          symbol: string
        }
        Update: {
          attempts?: number
          bot_id?: string | null
          bot_name?: string
          created_at?: string
          error?: string | null
          id?: string
          idempotency_key?: string
          mode?: string
          pnl?: number
          price?: number
          quantity?: number
          side?: string
          status?: string
          symbol?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_executions_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_logs: {
        Row: {
          bot_id: string
          created_at: string
          id: string
          level: string
          message: string
        }
        Insert: {
          bot_id: string
          created_at?: string
          id?: string
          level?: string
          message: string
        }
        Update: {
          bot_id?: string
          created_at?: string
          id?: string
          level?: string
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_logs_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_performance_history: {
        Row: {
          bot_id: string | null
          bot_name: string
          capital: number
          id: string
          is_demo: boolean
          pnl: number
          recorded_on: string
          return_pct: number
        }
        Insert: {
          bot_id?: string | null
          bot_name: string
          capital: number
          id?: string
          is_demo?: boolean
          pnl: number
          recorded_on: string
          return_pct: number
        }
        Update: {
          bot_id?: string | null
          bot_name?: string
          capital?: number
          id?: string
          is_demo?: boolean
          pnl?: number
          recorded_on?: string
          return_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "bot_performance_history_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      bots: {
        Row: {
          auto_stop_reason: string | null
          automation_enabled: boolean
          capital: number
          created_at: string
          daily_loss: number
          demo_engine: string
          exchange: string
          id: string
          last_tick_at: string | null
          max_capital: number
          max_daily_loss: number
          max_drawdown_pct: number
          max_trades_per_day: number
          mode: string
          name: string
          pair: string
          peak_pnl: number
          pnl: number
          risk_day: string
          status: string
          stop_loss_pct: number
          strategy: string
          trades_today: number
          updated_at: string
          win_rate: number
        }
        Insert: {
          auto_stop_reason?: string | null
          automation_enabled?: boolean
          capital?: number
          created_at?: string
          daily_loss?: number
          demo_engine?: string
          exchange?: string
          id?: string
          last_tick_at?: string | null
          max_capital?: number
          max_daily_loss?: number
          max_drawdown_pct?: number
          max_trades_per_day?: number
          mode?: string
          name: string
          pair: string
          peak_pnl?: number
          pnl?: number
          risk_day?: string
          status?: string
          stop_loss_pct?: number
          strategy: string
          trades_today?: number
          updated_at?: string
          win_rate?: number
        }
        Update: {
          auto_stop_reason?: string | null
          automation_enabled?: boolean
          capital?: number
          created_at?: string
          daily_loss?: number
          demo_engine?: string
          exchange?: string
          id?: string
          last_tick_at?: string | null
          max_capital?: number
          max_daily_loss?: number
          max_drawdown_pct?: number
          max_trades_per_day?: number
          mode?: string
          name?: string
          pair?: string
          peak_pnl?: number
          pnl?: number
          risk_day?: string
          status?: string
          stop_loss_pct?: number
          strategy?: string
          trades_today?: number
          updated_at?: string
          win_rate?: number
        }
        Relationships: []
      }
      engine_runs: {
        Row: {
          bots_processed: number
          duration_ms: number
          errors: number
          finished_at: string | null
          id: string
          notes: string | null
          orders_created: number
          retries: number
          started_at: string
          status: string
          trigger: string
        }
        Insert: {
          bots_processed?: number
          duration_ms?: number
          errors?: number
          finished_at?: string | null
          id?: string
          notes?: string | null
          orders_created?: number
          retries?: number
          started_at?: string
          status?: string
          trigger?: string
        }
        Update: {
          bots_processed?: number
          duration_ms?: number
          errors?: number
          finished_at?: string | null
          id?: string
          notes?: string | null
          orders_created?: number
          retries?: number
          started_at?: string
          status?: string
          trigger?: string
        }
        Relationships: []
      }
      fund_accounts: {
        Row: {
          available_balance: number
          created_at: string
          currency: string
          id: string
          in_use_balance: number
          label: string
          updated_at: string
        }
        Insert: {
          available_balance?: number
          created_at?: string
          currency?: string
          id?: string
          in_use_balance?: number
          label?: string
          updated_at?: string
        }
        Update: {
          available_balance?: number
          created_at?: string
          currency?: string
          id?: string
          in_use_balance?: number
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      fund_transactions: {
        Row: {
          account_id: string
          amount: number
          created_at: string
          id: string
          kind: string
          method: string
          reference: string | null
          status: string
        }
        Insert: {
          account_id: string
          amount: number
          created_at?: string
          id?: string
          kind: string
          method: string
          reference?: string | null
          status?: string
        }
        Update: {
          account_id?: string
          amount?: number
          created_at?: string
          id?: string
          kind?: string
          method?: string
          reference?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fund_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "fund_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      market_prices: {
        Row: {
          id: string
          is_demo: boolean
          price: number
          recorded_on: string
          source: string
          symbol: string
        }
        Insert: {
          id?: string
          is_demo?: boolean
          price: number
          recorded_on: string
          source?: string
          symbol: string
        }
        Update: {
          id?: string
          is_demo?: boolean
          price?: number
          recorded_on?: string
          source?: string
          symbol?: string
        }
        Relationships: []
      }
      mining_hashrate_history: {
        Row: {
          coin: string
          hash_rate: number
          hash_unit: string
          id: string
          is_demo: boolean
          recorded_on: string
          worker_id: string | null
          worker_name: string
        }
        Insert: {
          coin: string
          hash_rate: number
          hash_unit?: string
          id?: string
          is_demo?: boolean
          recorded_on: string
          worker_id?: string | null
          worker_name: string
        }
        Update: {
          coin?: string
          hash_rate?: number
          hash_unit?: string
          id?: string
          is_demo?: boolean
          recorded_on?: string
          worker_id?: string | null
          worker_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "mining_hashrate_history_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "mining_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      mining_payouts: {
        Row: {
          amount: number
          coin: string
          id: string
          paid_at: string
          pool: string
          usd_value: number
        }
        Insert: {
          amount: number
          coin: string
          id?: string
          paid_at?: string
          pool: string
          usd_value?: number
        }
        Update: {
          amount?: number
          coin?: string
          id?: string
          paid_at?: string
          pool?: string
          usd_value?: number
        }
        Relationships: []
      }
      mining_workers: {
        Row: {
          coin: string
          created_at: string
          estimated_daily_earnings: number
          hash_rate: number
          hash_unit: string
          id: string
          name: string
          pool: string
          rig_id: string
          status: string
          updated_at: string
          uptime_seconds: number
        }
        Insert: {
          coin: string
          created_at?: string
          estimated_daily_earnings?: number
          hash_rate?: number
          hash_unit?: string
          id?: string
          name: string
          pool: string
          rig_id: string
          status?: string
          updated_at?: string
          uptime_seconds?: number
        }
        Update: {
          coin?: string
          created_at?: string
          estimated_daily_earnings?: number
          hash_rate?: number
          hash_unit?: string
          id?: string
          name?: string
          pool?: string
          rig_id?: string
          status?: string
          updated_at?: string
          uptime_seconds?: number
        }
        Relationships: []
      }
      training_runs: {
        Row: {
          bot_id: string | null
          bot_name: string
          created_at: string
          drawdown_pct: number
          id: string
          promoted: boolean
          return_pct: number
          sandbox_id: string
          suggested_params: Json
          win_rate: number
        }
        Insert: {
          bot_id?: string | null
          bot_name: string
          created_at?: string
          drawdown_pct?: number
          id?: string
          promoted?: boolean
          return_pct?: number
          sandbox_id: string
          suggested_params?: Json
          win_rate?: number
        }
        Update: {
          bot_id?: string | null
          bot_name?: string
          created_at?: string
          drawdown_pct?: number
          id?: string
          promoted?: boolean
          return_pct?: number
          sandbox_id?: string
          suggested_params?: Json
          win_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "training_runs_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_runs_sandbox_id_fkey"
            columns: ["sandbox_id"]
            isOneToOne: false
            referencedRelation: "training_sandboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      training_sandboxes: {
        Row: {
          ai_notes: string | null
          ai_sources: Json
          created_at: string
          dataset: string
          date_from: string
          date_to: string
          drawdown_pct: number | null
          id: string
          name: string
          pairs: string[]
          return_pct: number | null
          simulated_capital: number
          speed: number
          status: string
          updated_at: string
          win_rate: number | null
        }
        Insert: {
          ai_notes?: string | null
          ai_sources?: Json
          created_at?: string
          dataset?: string
          date_from: string
          date_to: string
          drawdown_pct?: number | null
          id?: string
          name: string
          pairs?: string[]
          return_pct?: number | null
          simulated_capital?: number
          speed?: number
          status?: string
          updated_at?: string
          win_rate?: number | null
        }
        Update: {
          ai_notes?: string | null
          ai_sources?: Json
          created_at?: string
          dataset?: string
          date_from?: string
          date_to?: string
          drawdown_pct?: number | null
          id?: string
          name?: string
          pairs?: string[]
          return_pct?: number | null
          simulated_capital?: number
          speed?: number
          status?: string
          updated_at?: string
          win_rate?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
