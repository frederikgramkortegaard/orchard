/**
 * Retry utilities with exponential backoff
 */

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Optional function to determine if error is retryable */
  isRetryable?: (error: Error) => boolean;
  /** Called before each retry with attempt number and delay */
  onRetry?: (attempt: number, delayMs: number, error: Error) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'isRetryable'>> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * Calculate delay for a given attempt using exponential backoff with jitter
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  multiplier: number = 2
): number {
  // Exponential backoff: baseDelay * multiplier^attempt
  const exponentialDelay = baseDelayMs * Math.pow(multiplier, attempt);
  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  // Add jitter (±20%) to prevent thundering herd
  const jitter = cappedDelay * 0.2 * (Math.random() * 2 - 1);
  return Math.floor(cappedDelay + jitter);
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      if (opts.isRetryable && !opts.isRetryable(lastError)) {
        throw lastError;
      }

      // Don't retry on last attempt
      if (attempt === opts.maxAttempts - 1) {
        break;
      }

      const delayMs = calculateBackoffDelay(
        attempt,
        opts.baseDelayMs,
        opts.maxDelayMs,
        opts.backoffMultiplier
      );

      // Call onRetry callback if provided
      if (opts.onRetry) {
        opts.onRetry(attempt + 1, delayMs, lastError);
      }

      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Circuit breaker states
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Number of failures before circuit opens (default: 3) */
  failureThreshold: number;
  /** Time in ms before attempting to close circuit (default: 60000) */
  resetTimeoutMs: number;
  /** Number of successful calls in half-open state to close circuit (default: 1) */
  successThreshold: number;
}

const DEFAULT_CIRCUIT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 3,
  resetTimeoutMs: 60000,
  successThreshold: 1,
};

/**
 * Circuit breaker implementation for managing failure states
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number | null = null;
  private options: CircuitBreakerOptions;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.options = { ...DEFAULT_CIRCUIT_OPTIONS, ...options };
  }

  getState(): CircuitState {
    // Check if we should transition from open to half-open
    if (this.state === 'open' && this.lastFailureTime) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.options.resetTimeoutMs) {
        this.state = 'half-open';
        this.successCount = 0;
      }
    }
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  isOpen(): boolean {
    return this.getState() === 'open';
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.options.successThreshold) {
        this.reset();
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed operation
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      // Any failure in half-open state opens the circuit
      this.state = 'open';
    } else if (this.state === 'closed' && this.failureCount >= this.options.failureThreshold) {
      this.state = 'open';
    }
  }

  /**
   * Reset the circuit breaker to closed state
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
  }

  /**
   * Serialize circuit breaker state
   */
  toJSON(): {
    state: CircuitState;
    failureCount: number;
    lastFailureTime: number | null;
  } {
    return {
      state: this.getState(),
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Restore circuit breaker state from serialized data
   */
  fromJSON(data: { state: CircuitState; failureCount: number; lastFailureTime: number | null }): void {
    this.state = data.state;
    this.failureCount = data.failureCount;
    this.lastFailureTime = data.lastFailureTime;
    this.successCount = 0;
  }
}
