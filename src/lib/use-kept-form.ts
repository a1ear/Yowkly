'use client';
import { startTransition } from 'react';

/**
 * React 19 resets a <form action={...}> after every submission, including
 * ones where the server returned a validation error, so people lose what they
 * typed or picked. Submitting through onSubmit keeps the form as it is; the
 * action still runs as a transition, so its pending state works as usual.
 */
export function keepFormOnSubmit(action: (data: FormData) => void) {
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  };
}
