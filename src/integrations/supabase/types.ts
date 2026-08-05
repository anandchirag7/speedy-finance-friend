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
      accounts: {
        Row: {
          account_number_last4: string | null
          category: Database["public"]["Enums"]["account_category"]
          created_at: string
          currency: string
          current_balance: number
          details: Json
          excluded_from_net_worth: boolean
          household_id: string
          id: string
          institution: string | null
          is_active: boolean
          is_liability: boolean
          name: string
          notes: string | null
          opening_balance: number
          subtype: string | null
          updated_at: string
        }
        Insert: {
          account_number_last4?: string | null
          category: Database["public"]["Enums"]["account_category"]
          created_at?: string
          currency?: string
          current_balance?: number
          details?: Json
          excluded_from_net_worth?: boolean
          household_id: string
          id?: string
          institution?: string | null
          is_active?: boolean
          is_liability?: boolean
          name: string
          notes?: string | null
          opening_balance?: number
          subtype?: string | null
          updated_at?: string
        }
        Update: {
          account_number_last4?: string | null
          category?: Database["public"]["Enums"]["account_category"]
          created_at?: string
          currency?: string
          current_balance?: number
          details?: Json
          excluded_from_net_worth?: boolean
          household_id?: string
          id?: string
          institution?: string | null
          is_active?: boolean
          is_liability?: boolean
          name?: string
          notes?: string | null
          opening_balance?: number
          subtype?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_payments: {
        Row: {
          account_id: string | null
          amount: number | null
          bill_id: string
          created_at: string
          created_by: string | null
          due_date: string
          household_id: string
          id: string
          notes: string | null
          paid_date: string | null
          status: string
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount?: number | null
          bill_id: string
          created_at?: string
          created_by?: string | null
          due_date: string
          household_id: string
          id?: string
          notes?: string | null
          paid_date?: string | null
          status?: string
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount?: number | null
          bill_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string
          household_id?: string
          id?: string
          notes?: string | null
          paid_date?: string | null
          status?: string
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_payments_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_payments_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_reminder_sends: {
        Row: {
          bill_id: string
          channel: string
          days_before: number
          due_date: string
          error: string | null
          household_id: string
          id: string
          provider_message_id: string | null
          recipient: string | null
          sent_at: string
          status: string
        }
        Insert: {
          bill_id: string
          channel?: string
          days_before: number
          due_date: string
          error?: string | null
          household_id: string
          id?: string
          provider_message_id?: string | null
          recipient?: string | null
          sent_at?: string
          status?: string
        }
        Update: {
          bill_id?: string
          channel?: string
          days_before?: number
          due_date?: string
          error?: string | null
          household_id?: string
          id?: string
          provider_message_id?: string | null
          recipient?: string | null
          sent_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_reminder_sends_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_reminder_sends_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      bills: {
        Row: {
          account_id: string | null
          amount: number | null
          auto_pay: boolean
          category_id: string | null
          created_at: string
          currency: string
          due_date: string
          end_date: string | null
          household_id: string
          id: string
          is_active: boolean
          is_estimated: boolean
          last_paid_on: string | null
          max_amount: number | null
          min_amount: number | null
          name: string
          notes: string | null
          payee_id: string | null
          priority: string
          recurrence: string
          reminder_days: number[]
          status: string
          tags: string[]
          updated_at: string
          url: string | null
          whatsapp_enabled: boolean
          whatsapp_number: string | null
        }
        Insert: {
          account_id?: string | null
          amount?: number | null
          auto_pay?: boolean
          category_id?: string | null
          created_at?: string
          currency?: string
          due_date: string
          end_date?: string | null
          household_id: string
          id?: string
          is_active?: boolean
          is_estimated?: boolean
          last_paid_on?: string | null
          max_amount?: number | null
          min_amount?: number | null
          name: string
          notes?: string | null
          payee_id?: string | null
          priority?: string
          recurrence?: string
          reminder_days?: number[]
          status?: string
          tags?: string[]
          updated_at?: string
          url?: string | null
          whatsapp_enabled?: boolean
          whatsapp_number?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number | null
          auto_pay?: boolean
          category_id?: string | null
          created_at?: string
          currency?: string
          due_date?: string
          end_date?: string | null
          household_id?: string
          id?: string
          is_active?: boolean
          is_estimated?: boolean
          last_paid_on?: string | null
          max_amount?: number | null
          min_amount?: number | null
          name?: string
          notes?: string | null
          payee_id?: string | null
          priority?: string
          recurrence?: string
          reminder_days?: number[]
          status?: string
          tags?: string[]
          updated_at?: string
          url?: string | null
          whatsapp_enabled?: boolean
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bills_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_payee_id_fkey"
            columns: ["payee_id"]
            isOneToOne: false
            referencedRelation: "memorized_payees"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_categories: {
        Row: {
          amount: number
          budget_id: string
          category_id: string
          id: string
        }
        Insert: {
          amount?: number
          budget_id: string
          category_id: string
          id?: string
        }
        Update: {
          amount?: number
          budget_id?: string
          category_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_categories_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          created_at: string
          end_date: string | null
          household_id: string
          id: string
          name: string
          period: string
          rollover: boolean
          start_date: string
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          household_id: string
          id?: string
          name: string
          period?: string
          rollover?: boolean
          start_date?: string
        }
        Update: {
          created_at?: string
          end_date?: string | null
          household_id?: string
          id?: string
          name?: string
          period?: string
          rollover?: boolean
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          group_label: string | null
          household_id: string
          icon: string | null
          id: string
          is_hidden: boolean
          is_system: boolean
          kind: string
          name: string
          parent_id: string | null
          scope: string
          sort_order: number
          tax_code: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          group_label?: string | null
          household_id: string
          icon?: string | null
          id?: string
          is_hidden?: boolean
          is_system?: boolean
          kind?: string
          name: string
          parent_id?: string | null
          scope?: string
          sort_order?: number
          tax_code?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          group_label?: string | null
          household_id?: string
          icon?: string | null
          id?: string
          is_hidden?: boolean
          is_system?: boolean
          kind?: string
          name?: string
          parent_id?: string | null
          scope?: string
          sort_order?: number
          tax_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          created_at: string
          household_id: string
          id: string
          message_id: string | null
          parts: Json
          role: string
          thread_id: string
        }
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          message_id?: string | null
          parts?: Json
          role: string
          thread_id: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          message_id?: string | null
          parts?: Json
          role?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_threads: {
        Row: {
          created_at: string
          household_id: string
          id: string
          last_message_at: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          last_message_at?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          last_message_at?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_threads_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboards: {
        Row: {
          created_at: string
          household_id: string
          id: string
          is_default: boolean
          layout: Json
          name: string
          settings: Json
          template_key: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          is_default?: boolean
          layout?: Json
          name: string
          settings?: Json
          template_key?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          is_default?: boolean
          layout?: Json
          name?: string
          settings?: Json
          template_key?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboards_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      data_reset_audit: {
        Row: {
          account_id: string | null
          account_name: string | null
          actor_id: string
          completed_at: string | null
          counts: Json
          created_at: string
          deleted: Json
          error: string | null
          household_id: string
          id: string
          kind: string
          scopes: string[]
          status: string
        }
        Insert: {
          account_id?: string | null
          account_name?: string | null
          actor_id: string
          completed_at?: string | null
          counts?: Json
          created_at?: string
          deleted?: Json
          error?: string | null
          household_id: string
          id?: string
          kind?: string
          scopes?: string[]
          status?: string
        }
        Update: {
          account_id?: string | null
          account_name?: string | null
          actor_id?: string
          completed_at?: string | null
          counts?: Json
          created_at?: string
          deleted?: Json
          error?: string | null
          household_id?: string
          id?: string
          kind?: string
          scopes?: string[]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_reset_audit_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      global_merchant_dictionary: {
        Row: {
          canonical_payee_name: string
          confidence_source: Database["public"]["Enums"]["merchant_confidence_source"]
          created_at: string
          id: string
          normalized_pattern: string
          suggested_category: string | null
          times_matched: number
          updated_at: string
        }
        Insert: {
          canonical_payee_name: string
          confidence_source?: Database["public"]["Enums"]["merchant_confidence_source"]
          created_at?: string
          id?: string
          normalized_pattern: string
          suggested_category?: string | null
          times_matched?: number
          updated_at?: string
        }
        Update: {
          canonical_payee_name?: string
          confidence_source?: Database["public"]["Enums"]["merchant_confidence_source"]
          created_at?: string
          id?: string
          normalized_pattern?: string
          suggested_category?: string | null
          times_matched?: number
          updated_at?: string
        }
        Relationships: []
      }
      goal_accounts: {
        Row: {
          account_id: string
          goal_id: string
          id: string
        }
        Insert: {
          account_id: string
          goal_id: string
          id?: string
        }
        Update: {
          account_id?: string
          goal_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_accounts_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          created_at: string
          expected_return_pct: number | null
          household_id: string
          id: string
          name: string
          notes: string | null
          target_amount: number
          target_date: string | null
        }
        Insert: {
          created_at?: string
          expected_return_pct?: number | null
          household_id: string
          id?: string
          name: string
          notes?: string | null
          target_amount: number
          target_date?: string | null
        }
        Update: {
          created_at?: string
          expected_return_pct?: number | null
          household_id?: string
          id?: string
          name?: string
          notes?: string | null
          target_amount?: number
          target_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goals_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      holding_transactions: {
        Row: {
          created_at: string
          holding_id: string
          id: string
          kind: string
          price: number
          quantity: number
          txn_date: string
        }
        Insert: {
          created_at?: string
          holding_id: string
          id?: string
          kind?: string
          price: number
          quantity: number
          txn_date: string
        }
        Update: {
          created_at?: string
          holding_id?: string
          id?: string
          kind?: string
          price?: number
          quantity?: number
          txn_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "holding_transactions_holding_id_fkey"
            columns: ["holding_id"]
            isOneToOne: false
            referencedRelation: "holdings"
            referencedColumns: ["id"]
          },
        ]
      }
      holdings: {
        Row: {
          account_id: string
          avg_price: number
          current_price: number
          id: string
          name: string | null
          quantity: number
          symbol: string
          updated_at: string
        }
        Insert: {
          account_id: string
          avg_price?: number
          current_price?: number
          id?: string
          name?: string | null
          quantity?: number
          symbol: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          avg_price?: number
          current_price?: number
          id?: string
          name?: string | null
          quantity?: number
          symbol?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "holdings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      household_members: {
        Row: {
          created_at: string
          household_id: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          base_currency: string
          created_at: string
          created_by: string
          id: string
          name: string
        }
        Insert: {
          base_currency?: string
          created_at?: string
          created_by: string
          id?: string
          name?: string
        }
        Update: {
          base_currency?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      import_rules: {
        Row: {
          category_id: string | null
          created_at: string
          household_id: string
          id: string
          match_field: string
          match_type: string
          match_value: string
          priority: number
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          household_id: string
          id?: string
          match_field?: string
          match_type?: string
          match_value: string
          priority?: number
        }
        Update: {
          category_id?: string | null
          created_at?: string
          household_id?: string
          id?: string
          match_field?: string
          match_type?: string
          match_value?: string
          priority?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rules_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      memorized_payees: {
        Row: {
          account_id: string | null
          address: string | null
          ai_suggestions: boolean
          aliases: string[]
          amount_tolerance_pct: number | null
          apply_to_downloaded: boolean
          apply_to_import: boolean
          apply_to_manual: boolean
          auto_amount: boolean
          auto_attach_receipt: boolean
          auto_budget: boolean
          auto_business: boolean
          auto_categorize: boolean
          auto_clear: boolean
          auto_memo: boolean
          auto_reviewed: boolean
          auto_tags: boolean
          auto_tax: boolean
          budget_link: string | null
          category_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          date_range_end: string | null
          date_range_start: string | null
          default_amount: number | null
          exact_match_only: boolean
          fuzzy_match: boolean
          household_id: string
          id: string
          is_disabled: boolean
          is_favorite: boolean
          is_recurring: boolean
          last_used_at: string | null
          locked: boolean
          match_tokens: string[]
          max_amount: number | null
          memo: string | null
          merchant: string
          merchant_type: string | null
          min_amount: number | null
          modified_by: string | null
          never_auto: boolean
          next_expected_date: string | null
          notes: string | null
          payment_method: string | null
          priority: number
          recurrence_day: number | null
          recurrence_freq: string | null
          reminder_days: number | null
          restrict_account_ids: string[]
          show_in_calendar: boolean
          splits: Json
          tags: string[]
          transfer_account_id: string | null
          txn_type: string
          updated_at: string
          usage_count: number
          website: string | null
        }
        Insert: {
          account_id?: string | null
          address?: string | null
          ai_suggestions?: boolean
          aliases?: string[]
          amount_tolerance_pct?: number | null
          apply_to_downloaded?: boolean
          apply_to_import?: boolean
          apply_to_manual?: boolean
          auto_amount?: boolean
          auto_attach_receipt?: boolean
          auto_budget?: boolean
          auto_business?: boolean
          auto_categorize?: boolean
          auto_clear?: boolean
          auto_memo?: boolean
          auto_reviewed?: boolean
          auto_tags?: boolean
          auto_tax?: boolean
          budget_link?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          date_range_end?: string | null
          date_range_start?: string | null
          default_amount?: number | null
          exact_match_only?: boolean
          fuzzy_match?: boolean
          household_id: string
          id?: string
          is_disabled?: boolean
          is_favorite?: boolean
          is_recurring?: boolean
          last_used_at?: string | null
          locked?: boolean
          match_tokens?: string[]
          max_amount?: number | null
          memo?: string | null
          merchant: string
          merchant_type?: string | null
          min_amount?: number | null
          modified_by?: string | null
          never_auto?: boolean
          next_expected_date?: string | null
          notes?: string | null
          payment_method?: string | null
          priority?: number
          recurrence_day?: number | null
          recurrence_freq?: string | null
          reminder_days?: number | null
          restrict_account_ids?: string[]
          show_in_calendar?: boolean
          splits?: Json
          tags?: string[]
          transfer_account_id?: string | null
          txn_type?: string
          updated_at?: string
          usage_count?: number
          website?: string | null
        }
        Update: {
          account_id?: string | null
          address?: string | null
          ai_suggestions?: boolean
          aliases?: string[]
          amount_tolerance_pct?: number | null
          apply_to_downloaded?: boolean
          apply_to_import?: boolean
          apply_to_manual?: boolean
          auto_amount?: boolean
          auto_attach_receipt?: boolean
          auto_budget?: boolean
          auto_business?: boolean
          auto_categorize?: boolean
          auto_clear?: boolean
          auto_memo?: boolean
          auto_reviewed?: boolean
          auto_tags?: boolean
          auto_tax?: boolean
          budget_link?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          date_range_end?: string | null
          date_range_start?: string | null
          default_amount?: number | null
          exact_match_only?: boolean
          fuzzy_match?: boolean
          household_id?: string
          id?: string
          is_disabled?: boolean
          is_favorite?: boolean
          is_recurring?: boolean
          last_used_at?: string | null
          locked?: boolean
          match_tokens?: string[]
          max_amount?: number | null
          memo?: string | null
          merchant?: string
          merchant_type?: string | null
          min_amount?: number | null
          modified_by?: string | null
          never_auto?: boolean
          next_expected_date?: string | null
          notes?: string | null
          payment_method?: string | null
          priority?: number
          recurrence_day?: number | null
          recurrence_freq?: string | null
          reminder_days?: number | null
          restrict_account_ids?: string[]
          show_in_calendar?: boolean
          splits?: Json
          tags?: string[]
          transfer_account_id?: string | null
          txn_type?: string
          updated_at?: string
          usage_count?: number
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memorized_payees_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memorized_payees_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memorized_payees_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memorized_payees_transfer_account_id_fkey"
            columns: ["transfer_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      net_worth_snapshots: {
        Row: {
          breakdown: Json
          household_id: string
          id: string
          net_worth: number
          snapshot_date: string
          total_assets: number
          total_liabilities: number
        }
        Insert: {
          breakdown?: Json
          household_id: string
          id?: string
          net_worth: number
          snapshot_date: string
          total_assets: number
          total_liabilities: number
        }
        Update: {
          breakdown?: Json
          household_id?: string
          id?: string
          net_worth?: number
          snapshot_date?: string
          total_assets?: number
          total_liabilities?: number
        }
        Relationships: [
          {
            foreignKeyName: "net_worth_snapshots_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      payee_rules: {
        Row: {
          category_id: string | null
          created_at: string
          default_amount: number | null
          household_id: string
          id: string
          is_active: boolean
          max_amount: number | null
          memo: string | null
          min_amount: number | null
          payee_id: string
          priority: number
          tags: string[]
          transfer_account_id: string | null
          txn_type: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          default_amount?: number | null
          household_id: string
          id?: string
          is_active?: boolean
          max_amount?: number | null
          memo?: string | null
          min_amount?: number | null
          payee_id: string
          priority?: number
          tags?: string[]
          transfer_account_id?: string | null
          txn_type: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          default_amount?: number | null
          household_id?: string
          id?: string
          is_active?: boolean
          max_amount?: number | null
          memo?: string | null
          min_amount?: number | null
          payee_id?: string
          priority?: number
          tags?: string[]
          transfer_account_id?: string | null
          txn_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payee_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payee_rules_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payee_rules_payee_id_fkey"
            columns: ["payee_id"]
            isOneToOne: false
            referencedRelation: "memorized_payees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payee_rules_transfer_account_id_fkey"
            columns: ["transfer_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      price_history: {
        Row: {
          id: string
          price: number
          price_date: string
          symbol: string
        }
        Insert: {
          id?: string
          price: number
          price_date: string
          symbol: string
        }
        Update: {
          id?: string
          price?: number
          price_date?: string
          symbol?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          app_lock_enabled: boolean
          created_at: string
          dark_mode: boolean
          default_household_id: string | null
          display_name: string | null
          id: string
          number_format: string
          updated_at: string
          use_lakh_crore: boolean
          whatsapp_number: string | null
          whatsapp_reminders_enabled: boolean
        }
        Insert: {
          app_lock_enabled?: boolean
          created_at?: string
          dark_mode?: boolean
          default_household_id?: string | null
          display_name?: string | null
          id: string
          number_format?: string
          updated_at?: string
          use_lakh_crore?: boolean
          whatsapp_number?: string | null
          whatsapp_reminders_enabled?: boolean
        }
        Update: {
          app_lock_enabled?: boolean
          created_at?: string
          dark_mode?: boolean
          default_household_id?: string | null
          display_name?: string | null
          id?: string
          number_format?: string
          updated_at?: string
          use_lakh_crore?: boolean
          whatsapp_number?: string | null
          whatsapp_reminders_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "profiles_default_household_id_fkey"
            columns: ["default_household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_templates: {
        Row: {
          account_id: string
          amount: number
          auto_post: boolean
          cadence: string
          category_id: string | null
          created_at: string
          household_id: string
          id: string
          name: string
          next_run: string
          type: Database["public"]["Enums"]["txn_type"]
        }
        Insert: {
          account_id: string
          amount: number
          auto_post?: boolean
          cadence?: string
          category_id?: string | null
          created_at?: string
          household_id: string
          id?: string
          name: string
          next_run: string
          type: Database["public"]["Enums"]["txn_type"]
        }
        Update: {
          account_id?: string
          amount?: number
          auto_post?: boolean
          cadence?: string
          category_id?: string | null
          created_at?: string
          household_id?: string
          id?: string
          name?: string
          next_run?: string
          type?: Database["public"]["Enums"]["txn_type"]
        }
        Relationships: [
          {
            foreignKeyName: "recurring_templates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_templates_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_templates_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      report_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error: string | null
          files: Json
          format: string
          from_date: string
          id: string
          progress: number
          progress_message: string | null
          report_ids: string[]
          status: string
          to_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          files?: Json
          format: string
          from_date: string
          id?: string
          progress?: number
          progress_message?: string | null
          report_ids?: string[]
          status?: string
          to_date: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          files?: Json
          format?: string
          from_date?: string
          id?: string
          progress?: number
          progress_message?: string | null
          report_ids?: string[]
          status?: string
          to_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      report_presets: {
        Row: {
          config: Json
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          config: Json
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      statement_archive_settings: {
        Row: {
          archive_enabled: boolean
          created_at: string
          household_id: string
          retention_days: number
          updated_at: string
        }
        Insert: {
          archive_enabled?: boolean
          created_at?: string
          household_id: string
          retention_days?: number
          updated_at?: string
        }
        Update: {
          archive_enabled?: boolean
          created_at?: string
          household_id?: string
          retention_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "statement_archive_settings_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: true
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      statement_uploads: {
        Row: {
          archive_expires_at: string | null
          created_at: string
          error: string | null
          filename: string
          household_id: string | null
          id: string
          import_token: string | null
          imported_at: string | null
          inserted_count: number
          mime_type: string | null
          processed_transactions: number
          result: Json
          size_bytes: number | null
          status: Database["public"]["Enums"]["statement_upload_status"]
          storage_path: string | null
          total_transactions: number
          unique_patterns: number
          updated_at: string
          user_id: string
        }
        Insert: {
          archive_expires_at?: string | null
          created_at?: string
          error?: string | null
          filename: string
          household_id?: string | null
          id?: string
          import_token?: string | null
          imported_at?: string | null
          inserted_count?: number
          mime_type?: string | null
          processed_transactions?: number
          result?: Json
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["statement_upload_status"]
          storage_path?: string | null
          total_transactions?: number
          unique_patterns?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          archive_expires_at?: string | null
          created_at?: string
          error?: string | null
          filename?: string
          household_id?: string | null
          id?: string
          import_token?: string | null
          imported_at?: string | null
          inserted_count?: number
          mime_type?: string | null
          processed_transactions?: number
          result?: Json
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["statement_upload_status"]
          storage_path?: string | null
          total_transactions?: number
          unique_patterns?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "statement_uploads_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_activity: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          household_id: string
          id: string
          transaction_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          household_id: string
          id?: string
          transaction_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          household_id?: string
          id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_activity_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_attachments: {
        Row: {
          created_at: string
          file_name: string
          household_id: string
          id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          transaction_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          household_id: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          transaction_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          household_id?: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          transaction_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transaction_attachments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          household_id: string
          id: string
          transaction_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          household_id: string
          id?: string
          transaction_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          household_id?: string
          id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_comments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_views: {
        Row: {
          created_at: string
          filters: Json
          household_id: string
          id: string
          is_default: boolean
          layout: Json
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filters?: Json
          household_id: string
          id?: string
          is_default?: boolean
          layout?: Json
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          filters?: Json
          household_id?: string
          id?: string
          is_default?: boolean
          layout?: Json
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          account_id: string
          amount: number
          attachment_count: number
          budget_id: string | null
          category_id: string | null
          check_number: string | null
          cleared_status: string
          comment_count: number
          created_at: string
          created_by: string | null
          household_id: string
          id: string
          import_batch_id: string | null
          is_favorite: boolean
          is_flagged: boolean
          is_read: boolean
          is_recurring_instance: boolean
          is_reviewed: boolean
          memo: string | null
          merchant: string | null
          normalized_pattern: string | null
          note: string | null
          payment_method: string | null
          split_parent_id: string | null
          tags: string[]
          tax_code: string | null
          transfer_account_id: string | null
          txn_date: string
          type: Database["public"]["Enums"]["txn_type"]
          updated_at: string
        }
        Insert: {
          account_id: string
          amount: number
          attachment_count?: number
          budget_id?: string | null
          category_id?: string | null
          check_number?: string | null
          cleared_status?: string
          comment_count?: number
          created_at?: string
          created_by?: string | null
          household_id: string
          id?: string
          import_batch_id?: string | null
          is_favorite?: boolean
          is_flagged?: boolean
          is_read?: boolean
          is_recurring_instance?: boolean
          is_reviewed?: boolean
          memo?: string | null
          merchant?: string | null
          normalized_pattern?: string | null
          note?: string | null
          payment_method?: string | null
          split_parent_id?: string | null
          tags?: string[]
          tax_code?: string | null
          transfer_account_id?: string | null
          txn_date?: string
          type: Database["public"]["Enums"]["txn_type"]
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount?: number
          attachment_count?: number
          budget_id?: string | null
          category_id?: string | null
          check_number?: string | null
          cleared_status?: string
          comment_count?: number
          created_at?: string
          created_by?: string | null
          household_id?: string
          id?: string
          import_batch_id?: string | null
          is_favorite?: boolean
          is_flagged?: boolean
          is_read?: boolean
          is_recurring_instance?: boolean
          is_reviewed?: boolean
          memo?: string | null
          merchant?: string | null
          normalized_pattern?: string | null
          note?: string | null
          payment_method?: string | null
          split_parent_id?: string | null
          tags?: string[]
          tax_code?: string | null
          transfer_account_id?: string | null
          txn_date?: string
          type?: Database["public"]["Enums"]["txn_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_split_parent_id_fkey"
            columns: ["split_parent_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_transfer_account_id_fkey"
            columns: ["transfer_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_payee_overrides: {
        Row: {
          category: string | null
          created_at: string
          id: string
          normalized_pattern: string
          payee_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          normalized_pattern: string
          payee_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          normalized_pattern?: string
          payee_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_household_access: {
        Args: { _household_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      seed_default_categories: {
        Args: { _household_id: string }
        Returns: undefined
      }
    }
    Enums: {
      account_category:
        | "bank"
        | "cash"
        | "credit_card"
        | "fixed_deposit"
        | "recurring_deposit"
        | "ppf"
        | "epf"
        | "nps"
        | "mutual_fund"
        | "stocks"
        | "post_office"
        | "gold"
        | "real_estate"
        | "loan"
        | "insurance"
        | "chit_fund"
        | "other"
      app_role: "admin" | "member"
      merchant_confidence_source: "seed" | "ai_classified" | "user_confirmed"
      statement_upload_status:
        | "parsing"
        | "deduplicating"
        | "classifying"
        | "complete"
        | "failed"
      txn_type: "income" | "expense" | "transfer"
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
      account_category: [
        "bank",
        "cash",
        "credit_card",
        "fixed_deposit",
        "recurring_deposit",
        "ppf",
        "epf",
        "nps",
        "mutual_fund",
        "stocks",
        "post_office",
        "gold",
        "real_estate",
        "loan",
        "insurance",
        "chit_fund",
        "other",
      ],
      app_role: ["admin", "member"],
      merchant_confidence_source: ["seed", "ai_classified", "user_confirmed"],
      statement_upload_status: [
        "parsing",
        "deduplicating",
        "classifying",
        "complete",
        "failed",
      ],
      txn_type: ["income", "expense", "transfer"],
    },
  },
} as const
