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
      eligibility_output: {
        Row: {
          decision: string
          facility: string
          has_partb: boolean
          missing_fields: string[]
          patient_id: string
          primary_extraction_id: string | null
          routing_reason: string
          updated_at: string
        }
        Insert: {
          decision: string
          facility: string
          has_partb?: boolean
          missing_fields?: string[]
          patient_id: string
          primary_extraction_id?: string | null
          routing_reason: string
          updated_at?: string
        }
        Update: {
          decision?: string
          facility?: string
          has_partb?: boolean
          missing_fields?: string[]
          patient_id?: string
          primary_extraction_id?: string | null
          routing_reason?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eligibility_output_primary_extraction_id_fkey"
            columns: ["primary_extraction_id"]
            isOneToOne: false
            referencedRelation: "wound_extractions"
            referencedColumns: ["id"]
          },
        ]
      }
      ingest_failures: {
        Row: {
          attempted_at: string
          endpoint: string
          error: string | null
          id: string
          patient_id: string | null
          status: number | null
        }
        Insert: {
          attempted_at?: string
          endpoint: string
          error?: string | null
          id?: string
          patient_id?: string | null
          status?: number | null
        }
        Update: {
          attempted_at?: string
          endpoint?: string
          error?: string | null
          id?: string
          patient_id?: string | null
          status?: number | null
        }
        Relationships: []
      }
      pipeline_runs: {
        Row: {
          extraction_failures: number | null
          finished_at: string | null
          http_429s: number | null
          id: string
          notes: string | null
          patients_processed: number | null
          started_at: string
          status: string
        }
        Insert: {
          extraction_failures?: number | null
          finished_at?: string | null
          http_429s?: number | null
          id?: string
          notes?: string | null
          patients_processed?: number | null
          started_at?: string
          status?: string
        }
        Update: {
          extraction_failures?: number | null
          finished_at?: string | null
          http_429s?: number | null
          id?: string
          notes?: string | null
          patients_processed?: number | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      raw_assessments: {
        Row: {
          fetched_at: string
          id: string
          patient_id: string
          payload: Json
        }
        Insert: {
          fetched_at?: string
          id: string
          patient_id: string
          payload: Json
        }
        Update: {
          fetched_at?: string
          id?: string
          patient_id?: string
          payload?: Json
        }
        Relationships: []
      }
      raw_coverage: {
        Row: {
          fetched_at: string
          patient_id: string
          payload: Json
        }
        Insert: {
          fetched_at?: string
          patient_id: string
          payload: Json
        }
        Update: {
          fetched_at?: string
          patient_id?: string
          payload?: Json
        }
        Relationships: []
      }
      raw_diagnoses: {
        Row: {
          fetched_at: string
          id: string
          patient_id: string
          payload: Json
        }
        Insert: {
          fetched_at?: string
          id: string
          patient_id: string
          payload: Json
        }
        Update: {
          fetched_at?: string
          id?: string
          patient_id?: string
          payload?: Json
        }
        Relationships: []
      }
      raw_notes: {
        Row: {
          body: string | null
          fetched_at: string
          format: string | null
          id: string
          patient_id: string
          payload: Json
        }
        Insert: {
          body?: string | null
          fetched_at?: string
          format?: string | null
          id: string
          patient_id: string
          payload: Json
        }
        Update: {
          body?: string | null
          fetched_at?: string
          format?: string | null
          id?: string
          patient_id?: string
          payload?: Json
        }
        Relationships: []
      }
      raw_patients: {
        Row: {
          facility: string
          fetched_at: string
          patient_id: string
          payload: Json
        }
        Insert: {
          facility: string
          fetched_at?: string
          patient_id: string
          payload: Json
        }
        Update: {
          facility?: string
          fetched_at?: string
          patient_id?: string
          payload?: Json
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wound_extractions: {
        Row: {
          confidence: string | null
          created_at: string
          depth_cm: number | null
          drainage: string | null
          extraction_notes: string | null
          id: string
          is_primary_wound: boolean | null
          length_cm: number | null
          location: string | null
          patient_id: string
          raw_json: Json | null
          source_id: string
          source_quote: string | null
          source_table: string
          width_cm: number | null
          wound_stage: string | null
          wound_type: string | null
        }
        Insert: {
          confidence?: string | null
          created_at?: string
          depth_cm?: number | null
          drainage?: string | null
          extraction_notes?: string | null
          id?: string
          is_primary_wound?: boolean | null
          length_cm?: number | null
          location?: string | null
          patient_id: string
          raw_json?: Json | null
          source_id: string
          source_quote?: string | null
          source_table: string
          width_cm?: number | null
          wound_stage?: string | null
          wound_type?: string | null
        }
        Update: {
          confidence?: string | null
          created_at?: string
          depth_cm?: number | null
          drainage?: string | null
          extraction_notes?: string | null
          id?: string
          is_primary_wound?: boolean | null
          length_cm?: number | null
          location?: string | null
          patient_id?: string
          raw_json?: Json | null
          source_id?: string
          source_quote?: string | null
          source_table?: string
          width_cm?: number | null
          wound_stage?: string | null
          wound_type?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
