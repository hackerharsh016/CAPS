# `@caps/ui`

Shared accessible presentational React components with Tailwind CSS for the CAPS Customer Web Portal and Shop Owner Dashboard.

---

## Component Catalogue

- **`<Button />`**: Accessible interactive button with variants (`primary`, `secondary`, `danger`, `outline`, `ghost`), sizes (`sm`, `md`, `lg`), `isLoading` spinner state with `aria-busy`, and `disabled` state with `aria-disabled`.
- **`<Input />`**: Accessible form input with associated `<label>`, `errorMessage` linked via `role="alert"` and `aria-describedby`, `helperText`, and `required` indicators.
- **`<Card />`**: Flexible layout card composed of `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, and `CardFooter`.
- **`<Badge />`**: Status badges for jobs and printers with variants (`default`, `success`, `warning`, `danger`, `info`, `urgent`).
- **`<Alert />`**: Accessible alert container with `role="alert"` and title/message support.

---

## Usage Example

```tsx
import { Button, Card, CardHeader, CardTitle, CardContent, Input, Badge } from '@caps/ui';

export function PrintJobCard({ job }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle>Job #{job.id}</CardTitle>
          <Badge variant={job.priority_tier === 'urgent' ? 'urgent' : 'default'} dot>
            {job.priority_tier}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Input label="Copies" defaultValue={job.settings.copies} />
        <Button variant="primary" className="mt-4">
          Confirm Print
        </Button>
      </CardContent>
    </Card>
  );
}
```
