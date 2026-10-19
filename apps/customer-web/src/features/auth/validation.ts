/**
 * Client-side input validation for CAPS Customer Auth forms.
 * Enforces security, email RFC standards, strong passwords, and Indian phone number formatting (+91).
 */

export interface FormFieldErrors {
  name?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  password?: string | undefined;
  confirmPassword?: string | undefined;
  otp?: string | undefined;
  terms?: string | undefined;
}

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const PHONE_REGEX = /^(?:\+91|91)?[6-9]\d{9}$/;

export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) {
    return 'Email address is required.';
  }
  if (!EMAIL_REGEX.test(trimmed)) {
    return 'Please enter a valid email address.';
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) {
    return 'Password is required.';
  }
  if (password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  return null;
}

export function validateConfirmPassword(password: string, confirmPassword: string): string | null {
  if (!confirmPassword) {
    return 'Please confirm your password.';
  }
  if (password !== confirmPassword) {
    return 'Passwords do not match.';
  }
  return null;
}

export function validatePhone(phone: string): string | null {
  const clean = phone.replace(/[\s-]/g, '');
  if (!clean) {
    return 'Phone number is required.';
  }
  if (!PHONE_REGEX.test(clean)) {
    return 'Please enter a valid 10-digit mobile number (e.g., 9876543210 or +919876543210).';
  }
  return null;
}

export function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return 'Full name is required.';
  }
  if (trimmed.length < 2) {
    return 'Name must be at least 2 characters.';
  }
  return null;
}

export function validateOtp(otp: string): string | null {
  const trimmed = otp.trim();
  if (!trimmed) {
    return 'Verification code is required.';
  }
  if (!/^\d{6}$/.test(trimmed)) {
    return 'Verification code must be exactly 6 digits.';
  }
  return null;
}

/**
 * Normalizes phone numbers to standard format (+91...).
 */
export function normalizePhone(phone: string): string {
  const clean = phone.replace(/[\s-]/g, '');
  if (clean.startsWith('+91')) {
    return clean;
  }
  if (clean.startsWith('91') && clean.length === 12) {
    return `+${clean}`;
  }
  return `+91${clean}`;
}
