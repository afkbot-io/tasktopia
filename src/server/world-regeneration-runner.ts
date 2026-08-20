export async function retryWorldRegeneration<T>(
  maxAttempts: number,
  operation: (attempt: number) => Promise<T>,
  onRetry: (attempt: number, error: Error) => void = () => undefined,
): Promise<{ attempt: number; value: T }> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be a positive integer");

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return { attempt, value: await operation(attempt) };
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      if (attempt === maxAttempts) throw failure;
      onRetry(attempt, failure);
    }
  }

  throw new Error("World regeneration exhausted without an attempt");
}
