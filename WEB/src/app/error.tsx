'use client';

// Next.js Error Boundary — catches runtime errors and shows a custom error screen
// instead of the default "This page couldn't load" message.
// Must be a client component with 'use client' directive.

import React, { useEffect } from 'react';
import { ErrorScreen } from '@/components/shared/Screens';

interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    // Log the error to console for debugging
    console.error('[App Error Boundary]', error);
  }, [error]);

  // Determine error type from the error object
  const errorCode = React.useMemo(() => {
    const msg = error?.message || '';
    if (/404|not found/i.test(msg)) return 404;
    if (/403|forbidden/i.test(msg)) return 403;
    if (/400|bad request/i.test(msg)) return 400;
    if (/502|bad gateway/i.test(msg)) return 502;
    if (/503|service unavailable/i.test(msg)) return 503;
    return 500;
  }, [error]);

  return (
    <ErrorScreen
      code={errorCode}
      message={error?.message || undefined}
      onRetry={reset}
      onHome={() => {
        reset();
        window.location.href = '/';
      }}
    />
  );
}
