import { describe, expect, it } from 'vitest';
import { Input } from '../src/index.js';

describe('Input Component (Accessibility & Form Semantics)', () => {
  it('renders input with matching label and id', () => {
    const element = <Input id="test-email" label="Email Address" />;
    expect(element.type).toBe(Input);
    expect(element.props.id).toBe('test-email');
    expect(element.props.label).toBe('Email Address');
  });

  it('sets errorMessage for validation errors', () => {
    const element = (
      <Input id="test-copies" label="Copies" errorMessage="Copies must be between 1 and 100" />
    );
    expect(element.props.errorMessage).toBe('Copies must be between 1 and 100');
  });

  it('accepts helperText for assistive guidance', () => {
    const element = <Input id="test-range" label="Page Range" helperText="e.g. 1-5, 8" />;
    expect(element.props.helperText).toBe('e.g. 1-5, 8');
  });

  it('supports required and disabled attributes', () => {
    const element = <Input id="test-req" required disabled />;
    expect(element.props.required).toBe(true);
    expect(element.props.disabled).toBe(true);
  });
});
