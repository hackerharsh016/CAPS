import { describe, it, expect } from 'vitest';
import CustomerHomePage from '../src/app/page.js';

describe('Customer Web Application Shell', () => {
  it('exports valid React page component', () => {
    expect(typeof CustomerHomePage).toBe('function');
    const element = CustomerHomePage();
    expect(element).toBeDefined();
    expect(element.type).toBe('div');
  });
});
