/**
 * User and Identity domain types for CAPS.
 */

export type UserRole = 'customer' | 'shop_owner' | 'admin';

export interface UserProfile {
  id: string; // UUID references auth.users
  role: UserRole;
  name: string;
  phone: string;
  email?: string;
  created_at: string;
  updated_at?: string;
}
