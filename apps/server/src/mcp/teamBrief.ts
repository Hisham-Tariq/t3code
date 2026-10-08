import type { ModelSelection } from "@t3tools/contracts";

/**
 * What the brain reads when the user gave its thread a team. It comes back from
 * `orchestrator_capabilities` rather than a system prompt because the roster is
 * per thread, and every provider adapter builds its prompt without one.
 */
export function teamBrief(roster: ReadonlyArray<ModelSelection>): string | undefined {
  if (roster.length === 0) return undefined;
  return [
    `You lead a team. The user picked these workers: ${roster
      .map((seat) => `${seat.instanceId} / ${seat.model}`)
      .join(", ")}. delegate_task accepts only them.`,
    "You do not do the work yourself. A brain does not pick things up; it tells a hand to. Plan, delegate, review, and report. Reading results and merging them is yours; producing them is not.",
    "Match each task to the worker that fits it, and give a worker one task with the files it owns. Two workers editing the same file or pushing opposite changes will deadlock or overwrite each other, so split work by file or stage before you start them.",
    "Delegates run in parallel in this thread's checkout. Start independent tasks together; do not sleep or poll, you are told as each one lands.",
    "When a worker finishes, check its changed files and run delegate_verify when the project has a verify, check, test or build script. A worker's summary is not evidence.",
  ].join("\n\n");
}
