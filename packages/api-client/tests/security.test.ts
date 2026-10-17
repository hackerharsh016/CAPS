import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_DIR = path.resolve(__dirname, '../src');

describe('Security & Secret Isolation (packages/api-client)', () => {
  it('does NOT contain Supabase service role secret references', () => {
    const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.ts'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(SRC_DIR, file), 'utf-8');
      expect(content).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(content).not.toContain('service_role');
    }
  });

  it('does NOT contain Razorpay secret key references', () => {
    const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.ts'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(SRC_DIR, file), 'utf-8');
      expect(content).not.toContain('RAZORPAY_KEY_SECRET');
      expect(content).not.toContain('rzp_secret');
    }
  });

  it('does NOT hardcode private keys or certificates', () => {
    const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.ts'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(SRC_DIR, file), 'utf-8');
      expect(content).not.toContain('BEGIN PRIVATE KEY');
      expect(content).not.toContain('BEGIN RSA PRIVATE KEY');
    }
  });
});
