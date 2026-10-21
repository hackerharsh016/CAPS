import { describe, it, expect } from 'vitest';
import OwnerDashboardPage from '../src/app/page';

describe('Owner Dashboard Application Shell', () => {
  it('exports valid React dashboard component', () => {
    expect(typeof OwnerDashboardPage).toBe('function');
    const element = OwnerDashboardPage();
    expect(element).toBeDefined();
    expect(element.props).toBeDefined();
  });
});
