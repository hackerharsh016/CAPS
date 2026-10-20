import { describe, it, expect } from 'vitest';
import {
  validateEmail,
  validatePassword,
  validateConfirmPassword,
  validatePhone,
  validateName,
  validateOtp,
  normalizePhone
} from '../../src/features/auth/validation';
import type { AuthError } from '../../src/features/auth/types';

describe('Auth Validation Utilities', () => {
  describe('Email Validation', () => {
    it('accepts standard valid email addresses', () => {
      expect(validateEmail('customer@example.com')).toBeNull();
      expect(validateEmail('user.name+tag@domain.co.in')).toBeNull();
      expect(validateEmail('student123@college.edu')).toBeNull();
    });

    it('rejects invalid or empty email addresses', () => {
      expect(validateEmail('')).toBe('Email address is required.');
      expect(validateEmail('   ')).toBe('Email address is required.');
      expect(validateEmail('notanemail')).toBe('Please enter a valid email address.');
      expect(validateEmail('user@')).toBe('Please enter a valid email address.');
      expect(validateEmail('@domain.com')).toBe('Please enter a valid email address.');
      expect(validateEmail('user@domain')).toBe('Please enter a valid email address.');
    });
  });

  describe('Password Validation', () => {
    it('accepts passwords meeting complexity rules (>=8 chars, letter + digit)', () => {
      expect(validatePassword('Passw0rd123')).toBeNull();
      expect(validatePassword('secure99print')).toBeNull();
      expect(validatePassword('CAPS@2026rocks')).toBeNull();
    });

    it('rejects passwords shorter than 8 characters', () => {
      expect(validatePassword('')).toBe('Password is required.');
      expect(validatePassword('Pass1')).toBe('Password must be at least 8 characters long.');
    });

    it('rejects passwords lacking letters or digits', () => {
      expect(validatePassword('1234567890')).toBe(
        'Password must contain at least one letter and one number.'
      );
      expect(validatePassword('abcdefghij')).toBe(
        'Password must contain at least one letter and one number.'
      );
    });
  });

  describe('Confirm Password Validation', () => {
    it('accepts matching passwords', () => {
      expect(validateConfirmPassword('Secret123', 'Secret123')).toBeNull();
    });

    it('rejects non-matching passwords', () => {
      expect(validateConfirmPassword('Secret123', 'Secret456')).toBe('Passwords do not match.');
      expect(validateConfirmPassword('Secret123', '')).toBe('Please confirm your password.');
    });
  });

  describe('Phone Number Validation & Normalization', () => {
    it('accepts valid 10-digit Indian mobile numbers and +91 formatted numbers', () => {
      expect(validatePhone('9876543210')).toBeNull();
      expect(validatePhone('+919876543210')).toBeNull();
      expect(validatePhone('919876543210')).toBeNull();
      expect(validatePhone('7000000000')).toBeNull();
      expect(validatePhone('8888888888')).toBeNull();
      expect(validatePhone('6123456789')).toBeNull();
    });

    it('rejects numbers starting with invalid digits or wrong lengths', () => {
      expect(validatePhone('')).toBe('Phone number is required.');
      expect(validatePhone('12345')).toContain('valid 10-digit mobile number');
      expect(validatePhone('5555555555')).toContain('valid 10-digit mobile number');
      expect(validatePhone('abcdefghij')).toContain('valid 10-digit mobile number');
    });

    it('normalizes phone numbers to canonical +91 format', () => {
      expect(normalizePhone('9876543210')).toBe('+919876543210');
      expect(normalizePhone('+919876543210')).toBe('+919876543210');
      expect(normalizePhone('919876543210')).toBe('+919876543210');
      expect(normalizePhone('98765-43210')).toBe('+919876543210');
    });
  });

  describe('Name Validation', () => {
    it('accepts valid full names', () => {
      expect(validateName('Rohit Kharode')).toBeNull();
      expect(validateName('Amit')).toBeNull();
    });

    it('rejects empty or single character names', () => {
      expect(validateName('')).toBe('Full name is required.');
      expect(validateName('  ')).toBe('Full name is required.');
      expect(validateName('A')).toBe('Name must be at least 2 characters.');
    });
  });

  describe('OTP Code Validation', () => {
    it('accepts 6-digit numeric OTP', () => {
      expect(validateOtp('123456')).toBeNull();
      expect(validateOtp('000999')).toBeNull();
    });

    it('rejects non-6-digit or non-numeric codes', () => {
      expect(validateOtp('')).toBe('Verification code is required.');
      expect(validateOtp('12345')).toBe('Verification code must be exactly 6 digits.');
      expect(validateOtp('1234567')).toBe('Verification code must be exactly 6 digits.');
      expect(validateOtp('12a456')).toBe('Verification code must be exactly 6 digits.');
    });
  });
});

describe('Form Error Translation and API Status Handling', () => {
  function translateAuthError(err: unknown): string {
    const authErr = err as AuthError;
    if (authErr?.status === 429 || authErr?.code === 'RATE_LIMIT_EXCEEDED') {
      return 'Too many login attempts. Please wait a few moments before trying again.';
    }
    if (authErr?.code === 'INVALID_OTP') {
      return 'The verification code you entered is invalid or has expired.';
    }
    if (authErr?.status === 400 || authErr?.code === 'INVALID_CREDENTIALS') {
      return 'Invalid email or password. Please check your details and try again.';
    }
    if (
      authErr?.message?.toLowerCase().includes('timeout') ||
      authErr?.message?.toLowerCase().includes('network')
    ) {
      return 'Connection timed out. Please check your network connection and retry.';
    }
    return authErr?.message || 'Failed to sign in. Please try again.';
  }

  it('correctly translates 400 invalid credentials error', () => {
    const error: AuthError = {
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid login credentials',
      status: 400
    };
    expect(translateAuthError(error)).toBe(
      'Invalid email or password. Please check your details and try again.'
    );
  });

  it('correctly translates 429 rate limit exceeded error', () => {
    const error: AuthError = {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests',
      status: 429
    };
    expect(translateAuthError(error)).toBe(
      'Too many login attempts. Please wait a few moments before trying again.'
    );
  });

  it('correctly translates timeout and network errors', () => {
    const error: AuthError = {
      code: 'TIMEOUT',
      message: 'Network request timeout after 10000ms'
    };
    expect(translateAuthError(error)).toBe(
      'Connection timed out. Please check your network connection and retry.'
    );
  });

  it('correctly translates invalid OTP error', () => {
    const error: AuthError = {
      code: 'INVALID_OTP',
      message: 'Token has expired or is invalid',
      status: 400
    };
    expect(translateAuthError(error)).toBe(
      'The verification code you entered is invalid or has expired.'
    );
  });
});
