import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  type ModelSelection,
  type OrchestrationV2ProviderThread,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./Orchestrator.ts";
import type { ProviderAdapterV2Event, ProviderAdapterV2Shape } from "./ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import { checkpointWorkspace } from "./testkit/ReplayFixtureWorkspace.ts";

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex-team-brief-test");
const brain = { instanceId, model: "brain-model" } satisfies ModelSelection;
const worker = {
  instanceId: ProviderInstanceId.make("antigravity-worker"),
  model: "worker-model",
} satisfies ModelSelection;

/** An adapter whose turns finish at once and remember the text they were sent. */
function makeRecordingAdapter(sent: Ref.Ref<ReadonlyArray<string>>): ProviderAdapterV2Shape {
  return {
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
    openSession: (sessionInput) =>
      Effect.gen(function* () {
        const events = yield* Queue.unbounded<ProviderAdapterV2Event>();
        const now = yield* DateTime.now;
        return {
          instanceId,
          driver,
          providerSessionId: sessionInput.providerSessionId,
          providerSession: {
            id: sessionInput.providerSessionId,
            driver,
            providerInstanceId: instanceId,
            status: "ready",
            cwd: sessionInput.runtimePolicy.cwd ?? "/fallback",
            model: sessionInput.modelSelection.model,
            capabilities: CodexProviderCapabilitiesV2,
            createdAt: now,
            updatedAt: now,
            lastError: null,
          },
          events: Stream.fromQueue(events),
          ensureThread: (threadInput) =>
            Effect.gen(function* () {
              const createdAt = yield* DateTime.now;
              return {
                id: ProviderThreadId.make(`provider-thread:${threadInput.threadId}`),
                driver,
                providerInstanceId: instanceId,
                providerSessionId: sessionInput.providerSessionId,
                appThreadId: threadInput.threadId,
                ownerNodeId: null,
                nativeThreadRef: {
                  driver,
                  nativeId: `native-thread:${threadInput.threadId}`,
                  strength: "strong",
                },
                nativeConversationHeadRef: null,
                status: "idle",
                firstRunOrdinal: null,
                lastRunOrdinal: null,
                handoffIds: [],
                forkedFrom: null,
                createdAt,
                updatedAt: createdAt,
              } satisfies OrchestrationV2ProviderThread;
            }),
          resumeThread: ({ providerThread }) => Effect.succeed(providerThread),
          startTurn: (input) =>
            Effect.gen(function* () {
              yield* Ref.update(sent, (texts) => [...texts, input.message.text]);
              const occurredAt = yield* DateTime.now;
              const providerTurnId = ProviderTurnId.make(`provider-turn:${input.attemptId}`);
              yield* Queue.offer(events, {
                type: "provider_turn.updated",
                driver,
                providerTurn: {
                  id: providerTurnId,
                  providerThreadId: input.providerThread.id,
                  nodeId: input.rootNodeId,
                  runAttemptId: input.attemptId,
                  nativeTurnRef: {
                    driver,
                    nativeId: `native:${providerTurnId}`,
                    strength: "strong",
                  },
                  ordinal: input.providerTurnOrdinal,
                  status: "completed",
                  startedAt: occurredAt,
                  completedAt: occurredAt,
                },
              });
              yield* Queue.offer(events, {
                type: "turn.terminal",
                driver,
                providerThreadId: input.providerThread.id,
                providerTurnId,
                runOrdinal: input.runOrdinal,
                status: "completed",
                failure: null,
                threadDisposition: "reusable",
              });
            }),
          steerTurn: () => Effect.void,
          interruptTurn: () => Effect.void,
          respondToRuntimeRequest: () => Effect.void,
          readThreadSnapshot: () => Effect.die("unused readThreadSnapshot"),
          rollbackThread: () => Effect.die("unused rollbackThread"),
          forkThread: () => Effect.die("unused forkThread"),
        };
      }),
  };
}

const sendOnce = (input: {
  readonly name: string;
  readonly text: string;
  readonly delegates?: ReadonlyArray<ModelSelection>;
}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const cwd = yield* checkpointWorkspace(input.name);
      const threadId = ThreadId.make(`thread:${input.name}`);
      const sent = yield* Ref.make<ReadonlyArray<string>>([]);
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        yield* orchestrator.dispatch({
          type: "thread.create",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make(`command:${input.name}:create`),
          threadId,
          projectId: ProjectId.make(`project:${input.name}`),
          title: "Team brief",
          modelSelection: brain,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: cwd,
          ...(input.delegates === undefined ? {} : { delegates: input.delegates }),
        });
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make(`command:${input.name}:send`),
          threadId,
          messageId: MessageId.make(`message:${input.name}`),
          text: input.text,
          attachments: [],
          modelSelection: brain,
          dispatchMode: { type: "start_immediately" },
        });
        for (let index = 0; index < 1_000; index += 1) {
          if ((yield* Ref.get(sent)).length > 0) return;
          yield* Effect.sleep("5 millis");
        }
        return yield* Effect.die("the adapter never received a turn");
      }).pipe(
        Effect.provide(
          ProviderReplayHarness.layerWithRegistry(
            { name: input.name },
            ProviderAdapterRegistry.layerSingle(makeRecordingAdapter(sent)),
          ),
        ),
      );
      return (yield* Ref.get(sent))[0]!;
    }),
  );

it.live("sends the team brief with the first message on a thread that has workers", () =>
  Effect.gen(function* () {
    const text = yield* sendOnce({
      name: "team-brief-with-workers",
      text: "research solar loans",
      delegates: [worker],
    });
    assert.isTrue(text.startsWith("[T3 Code team brief]"));
    assert.include(text, "antigravity-worker / worker-model");
    assert.isTrue(text.endsWith("research solar loans"));
  }),
);

it.live("sends a thread without workers exactly what the user typed", () =>
  Effect.gen(function* () {
    const text = yield* sendOnce({ name: "team-brief-no-workers", text: "research solar loans" });
    assert.equal(text, "research solar loans");
  }),
);

it.live("leaves a slash command at the start of the prompt", () =>
  Effect.gen(function* () {
    const text = yield* sendOnce({
      name: "team-brief-slash",
      text: "/review",
      delegates: [worker],
    });
    assert.equal(text, "/review");
  }),
);
