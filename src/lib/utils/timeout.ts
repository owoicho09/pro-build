// Live-testing discovery (see README "Live integration test"): a builder
// engine call can hang indefinitely with no error and no response — neither
// request in the observed case ever reached v0 at all, so it's an outbound
// network/fetch hang, not a v0-side rejection. Every external builder call
// must be bounded, or a single stuck request strands its build forever with
// no visible failure state.
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
