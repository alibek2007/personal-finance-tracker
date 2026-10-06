import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

/**
 * Maps a server error onto the form: field-level details go under their fields,
 * anything else becomes the returned form-level message.
 */
export function applyApiError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
): string | null {
  if (!(error instanceof ApiError)) {
    return 'Something unexpected happened on our side. Try again in a moment.';
  }
  let mapped = 0;
  for (const [field, messages] of Object.entries(error.details ?? {})) {
    if (field === '_') continue;
    setError(field as Path<T>, { type: 'server', message: messages[0] ?? error.message });
    mapped += 1;
  }
  return mapped > 0 ? null : error.message;
}
