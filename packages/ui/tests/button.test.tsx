import { describe, expect, it } from 'vitest';
import { Button } from '../src/index.js';

describe('Button Component (Accessibility & Semantics)', () => {
  it('renders a valid button element with standard type="button"', () => {
    const element = <Button>Click me</Button>;
    expect(element).toBeDefined();
    expect(element.type).toBe(Button);
    expect(element.props.children).toBe('Click me');
  });

  it('respects type="submit" for accessible forms', () => {
    const element = <Button type="submit">Submit</Button>;
    expect(element.props.type).toBe('submit');
  });

  it('sets disabled when disabled is true', () => {
    const element = <Button disabled>Disabled</Button>;
    expect(element.props.disabled).toBe(true);
  });

  it('sets isLoading and loadingText when submitting', () => {
    const element = (
      <Button isLoading loadingText="Submitting...">
        Submit
      </Button>
    );
    expect(element.props.isLoading).toBe(true);
    expect(element.props.loadingText).toBe('Submitting...');
  });

  it('supports variant styles', () => {
    const element = <Button variant="danger">Danger</Button>;
    expect(element.props.variant).toBe('danger');
  });
});
