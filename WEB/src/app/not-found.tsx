'use client';

// Custom 404 Not Found page — replaces Next.js default "404 This page could not be found."

import { ErrorScreen } from '@/components/shared/Screens';

export default function NotFound() {
  return (
    <ErrorScreen
      code={404}
      onHome={() => {
        window.location.href = '/';
      }}
    />
  );
}
