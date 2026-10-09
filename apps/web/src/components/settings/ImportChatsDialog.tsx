import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import { CommandId, type AgentSessionProjectCandidate } from "@t3tools/contracts";
import { useMemo, useState } from "react";

import { resolveOnboardingProjectId } from "../../onboarding/projectImport.logic";
import { useProjectScans } from "../../onboarding/useProjectScans";
import { newProjectId } from "../../lib/utils";
import { agentSessionImport } from "../../state/agentSessions";
import { readProjects } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

const NO_ENVIRONMENTS: readonly never[] = [];

/**
 * Brings Claude Code and Codex conversations into T3 Code after setup.
 *
 * The welcome wizard ticks only repositories with three or more recent chats, so
 * a project with a single conversation is easy to miss. This lists every
 * directory the agents have run in and ticks none of them.
 */
export function ImportChatsDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const environmentId = usePrimaryEnvironmentId();
  const environmentIds = useMemo(
    () => (props.open && environmentId !== null ? [environmentId] : NO_ENVIRONMENTS),
    [environmentId, props.open],
  );
  const [scan] = useProjectScans(environmentIds);
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const importThreads = useAtomCommand(agentSessionImport, { reportFailure: false });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [isImporting, setIsImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const candidates = useMemo(
    () =>
      [...(scan?.data?.candidates ?? [])].toSorted((left, right) =>
        (right.lastActiveAt ?? "").localeCompare(left.lastActiveAt ?? ""),
      ),
    [scan?.data],
  );

  const importSelected = async () => {
    if (environmentId === null) return;
    setIsImporting(true);
    setMessage(null);
    let imported = 0;
    let failed = 0;
    for (const candidate of candidates.filter((entry) => selected.has(entry.path))) {
      let projectId = resolveOnboardingProjectId(readProjects(), environmentId, candidate);
      if (projectId === null) {
        const nextProjectId = newProjectId();
        const created = await createProject({
          environmentId,
          input: {
            projectId: nextProjectId,
            commandId: CommandId.make(`import-chats:project:create:${nextProjectId}`),
            title: candidate.title,
            workspaceRoot: candidate.path,
            createWorkspaceRootIfMissing: false,
            defaultModelSelection: null,
          },
        });
        if (created._tag !== "Success") {
          if (!isAtomCommandInterrupted(created)) failed += 1;
          continue;
        }
        projectId = nextProjectId;
      }
      const result = await importThreads({
        environmentId,
        input: { projectId, expectedWorkspaceRoot: candidate.path },
      });
      if (result._tag === "Success") {
        imported += result.value.importedCount;
        failed += result.value.skippedCount;
      } else if (!isAtomCommandInterrupted(result)) {
        failed += 1;
      }
    }
    setIsImporting(false);
    scan?.refresh();
    setMessage(
      failed === 0
        ? `Imported ${imported} ${imported === 1 ? "chat" : "chats"}.`
        : `Imported ${imported} ${imported === 1 ? "chat" : "chats"}. ${failed} could not be imported.`,
    );
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Import chats</DialogTitle>
          <DialogDescription>
            Conversations from Claude Code and Codex on this computer. Importing a folder that is
            not a project yet adds it as one.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {scan?.error ? (
            <p className="text-destructive text-sm">{scan.error}</p>
          ) : scan === undefined || (scan.data === null && scan.isPending) ? (
            <p className="text-muted-foreground text-sm">Looking for conversations…</p>
          ) : candidates.length === 0 ? (
            <p className="text-muted-foreground text-sm">No Claude Code or Codex chats found.</p>
          ) : (
            <ul className="grid max-h-96 gap-1 overflow-y-auto">
              {candidates.map((candidate: AgentSessionProjectCandidate) => (
                <li key={candidate.path}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2">
                    <Checkbox
                      checked={selected.has(candidate.path)}
                      onCheckedChange={(checked) => {
                        const next = new Set(selected);
                        if (checked) next.add(candidate.path);
                        else next.delete(candidate.path);
                        setSelected(next);
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-medium text-sm">{candidate.title}</span>
                        <span className="shrink-0 text-muted-foreground text-xs">
                          {candidate.threadCount} {candidate.threadCount === 1 ? "chat" : "chats"}
                          {candidate.alreadyImported ? " · project exists" : ""}
                        </span>
                      </span>
                      <span className="block truncate text-muted-foreground text-xs">
                        {candidate.path}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {message ? <p className="mt-3 text-sm">{message}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Close
          </Button>
          <Button disabled={isImporting || selected.size === 0} onClick={importSelected}>
            {isImporting ? "Importing…" : `Import ${selected.size || ""}`.trim()}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
