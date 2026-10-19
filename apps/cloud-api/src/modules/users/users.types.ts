export type UserRole = 'customer' | 'shop_owner' | 'admin';

export interface UserProfile {
  id: string; // Auth UUID referencing auth.users
  role: UserRole;
  name: string;
  phone: string;
  email?: string | undefined;
  created_at: string;
  updated_at?: string | undefined;
}

export interface CreateUserProfileDto {
  id: string;
  role?: UserRole;
  name: string;
  phone: string;
  email?: string | undefined;
}

export interface UpdateUserProfileDto {
  name?: string;
  phone?: string;
  email?: string | undefined;
}
