/**
 * Which of a project's own scripts proves the work holds. Reuses what the user
 * already configured (Project settings > Scripts) instead of a second place to
 * say how to build or test.
 */
export function resolveVerifyScript<Script extends { readonly name: string }>(
  scripts: ReadonlyArray<Script>,
  requested: string | undefined,
): Script | undefined {
  const named = (name: string) =>
    scripts.find((script) => script.name.trim().toLowerCase() === name);
  if (requested !== undefined) return named(requested.trim().toLowerCase());
  for (const preferred of ["verify", "check", "test", "build"]) {
    const match = named(preferred);
    if (match) return match;
  }
  return undefined;
}
