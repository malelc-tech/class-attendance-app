// Hand-written types matching supabase/schema.sql.
// In real usage, replace this file by running:
//   npx supabase gen types typescript --project-id <id> > src/lib/supabase/types.ts

export type UserRole = "student" | "teacher" | "admin";
export type AttendanceStatus = "present" | "late" | "rejected";
export type ClassStatus = "scheduled" | "active" | "closed";

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          full_name: string;
          email: string;
          role: UserRole;
          student_id: string | null;
          device_fingerprint: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["users"]["Row"]> & {
          id: string;
          full_name: string;
          email: string;
        };
        Update: Partial<Database["public"]["Tables"]["users"]["Row"]>;
      };
      courses: {
        Row: {
          id: string;
          code: string;
          title: string;
          teacher_id: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["courses"]["Row"]> & {
          code: string;
          title: string;
          teacher_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["courses"]["Row"]>;
      };
      classes: {
        Row: {
          id: string;
          course_id: string;
          teacher_id: string;
          title: string;
          status: ClassStatus;
          latitude: number;
          longitude: number;
          allowed_radius_meters: number;
          starts_at: string;
          ends_at: string | null;
          qr_secret: string;
          late_after_minutes: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["classes"]["Row"]> & {
          course_id: string;
          teacher_id: string;
          title: string;
          latitude: number;
          longitude: number;
        };
        Update: Partial<Database["public"]["Tables"]["classes"]["Row"]>;
      };
      attendance_logs: {
        Row: {
          id: string;
          class_id: string;
          student_id: string;
          status: AttendanceStatus;
          scanned_at: string;
          latitude: number;
          longitude: number;
          distance_meters: number;
          device_fingerprint: string;
          qr_token_used: string;
          ip_address: string | null;
        };
        Insert: Partial<
          Database["public"]["Tables"]["attendance_logs"]["Row"]
        > & {
          class_id: string;
          student_id: string;
          latitude: number;
          longitude: number;
          distance_meters: number;
          device_fingerprint: string;
          qr_token_used: string;
        };
        Update: Partial<Database["public"]["Tables"]["attendance_logs"]["Row"]>;
      };
    };
  };
}
