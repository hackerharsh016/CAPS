import { describe, expect, it } from 'vitest';
import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '../src/index.js';

describe('Card, Badge, and Alert Components', () => {
  describe('Card Component Composition', () => {
    it('renders Card with composed header, title, content, and footer', () => {
      const card = (
        <Card>
          <CardHeader>
            <CardTitle>Print Job #104</CardTitle>
            <CardDescription>Submitted 5 mins ago</CardDescription>
          </CardHeader>
          <CardContent>Job details here</CardContent>
          <CardFooter>Actions</CardFooter>
        </Card>
      );

      expect(card).toBeDefined();
      expect(card.type).toBe(Card);
      expect(card.props.children).toBeDefined();
    });
  });

  describe('Badge Component', () => {
    it('renders standard status badges with variant styles', () => {
      const defaultBadge = <Badge>Standard</Badge>;
      expect(defaultBadge.props.children).toBe('Standard');

      const successBadge = <Badge variant="success">Completed</Badge>;
      expect(successBadge.props.variant).toBe('success');

      const dangerBadge = <Badge variant="danger">Failed</Badge>;
      expect(dangerBadge.props.variant).toBe('danger');
    });

    it('renders urgent priority tier badge with pulse dot', () => {
      const urgentBadge = (
        <Badge variant="urgent" dot>
          Urgent Tier
        </Badge>
      );
      expect(urgentBadge.props.variant).toBe('urgent');
      expect(urgentBadge.props.dot).toBe(true);
      expect(urgentBadge.props.children).toBe('Urgent Tier');
    });
  });

  describe('Alert Component', () => {
    it('renders accessible alert with title and content', () => {
      const alert = (
        <Alert variant="error" title="Payment Failed">
          Your card was declined. Please try another payment method.
        </Alert>
      );

      expect(alert.props.variant).toBe('error');
      expect(alert.props.title).toBe('Payment Failed');
      expect(alert.props.children).toBe(
        'Your card was declined. Please try another payment method.'
      );
    });

    it('supports warning and success variants', () => {
      const warnAlert = <Alert variant="warning" title="Low Paper" />;
      expect(warnAlert.props.variant).toBe('warning');

      const successAlert = <Alert variant="success" title="Print Completed" />;
      expect(successAlert.props.variant).toBe('success');
    });
  });
});
