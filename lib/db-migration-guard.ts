/** True when Postgres reports a missing column (pre-migration 0019 on shared DB). */
export function isUndefinedColumnError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "42703"
  );
}
