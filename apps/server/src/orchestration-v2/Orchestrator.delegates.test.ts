import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import type { ProviderAdapterV2Shape } from "./ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const worker = { instanceId: ProviderInstanceId.make("antigravity"), model: "gemini-3-flash" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for roster commands"),
} as ProviderAdapterV2Shape;
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "delegates" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);

it.effect("keeps the worker roster chosen at creation and lets it change afterwards", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const threadId = ThreadId.make("thread:roster");
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("create-roster"),
      threadId,
      projectId: ProjectId.make("project:roster"),
      title: "Team",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      delegates: [worker],
      createdBy: "user",
      creationSource: "web",
    });
    const created = yield* projections.getThreadProjection(threadId);
    assert.deepEqual(created.thread.delegates, [worker]);
    // The sidebar reads shells, so the roster has to survive that projection too.
    const createdShell = yield* projections.getThreadShell(threadId);
    assert.deepEqual(createdShell?.delegates, [worker]);

    yield* orchestrator.dispatch({
      type: "thread.delegates.set",
      commandId: CommandId.make("roster-set"),
      threadId,
      delegates: [],
    });
    const cleared = yield* projections.getThreadProjection(threadId);
    assert.deepEqual(cleared.thread.delegates, []);
    const clearedShell = yield* projections.getThreadShell(threadId);
    assert.deepEqual(clearedShell?.delegates, []);
  }).pipe(Effect.provide(layerTest)),
);
