# Zed-Inspired Thread Manager

## TL;DR
> Summary:      Add a lightweight thread-history layer to the Terminal Manager dashboard, inspired by Zed's split between live entries and archived/history metadata. The feature persists metadata for tmux, zellij, and native shell "threads" without storing prompts or terminal output.
> Deliverables:
> - Shared host/webview DTOs for thread-history entries and dashboard actions
> - `ThreadHistoryStore` service backed by VS Code global state
> - TerminalDashboardProvider payload/action integration
> - Preact history view with filter, archive/restore/delete/rename, and activate/reopen actions
> - TDD RED->GREEN tests plus tmux manual QA evidence under `.omo/evidence/zed-thread-manager/`
> Effort:       Large
> Risk:         Medium - target files are already dirty and dashboard/session contracts span host, browser, persistence, and VS Code command surfaces

## Scope
### Must have
- Define "thread" for this repo as a lightweight history record for one terminal-backed work item:
  - tmux: identity is `backend:tmux:session:<sessionId>`
  - zellij: identity is `backend:zellij:session:<sessionId>`
  - native: identity is `backend:native:instance:<instanceId>`
- Persist only metadata: backend, session/instance id, title, title override, workspace label, workspace URI, created/updated/interacted/last-seen timestamps, archived flag, parent thread id placeholder, and last-known state.
- Persist with VS Code `ExtensionContext.globalState` under `ulw.threadHistory.v1`; cap at 300 records; never persist prompts, terminal output, pane contents, HTTP responses, or preview text.
- Add a dedicated service in `src/services/ThreadHistoryStore.ts` with tests in `src/services/ThreadHistoryStore.test.ts`.
- Extend `src/types.ts` first, then mirror dashboard-browser types in `src/webview/dashboard/types.ts`.
- Extend the TerminalDashboardProvider-driven dashboard only: sidebar dashboard view and the `TerminalDashboardProvider.show()` panel.
- Keep the current "opened/all projects" scope toggle behavior and apply the same workspace filtering to history unless `showingAll` is active.
- Add dashboard history mode with:
  - Current/History toggle
  - text filter for title, workspace, backend, session id, and instance id
  - live/current/closed/archived states
  - activate/reopen for live entries with workspace URI
  - archive, restore, delete, and rename title override actions
- Update history on dashboard discovery and after relevant dashboard actions using reload-on-write semantics.
- Use Zed only as a conceptual reference:
  - metadata cache plus persisted records
  - newest-first ordering
  - archived/history split
  - active entry separate from selected/filter state
  - title override preserving user rename
  - parent/subthread placeholder filtered from top-level lists

### Must NOT have (guardrails, anti-slop, scope boundaries)
- Do not copy Zed source code, exact Rust structs, SQL schema strings, UI markup, naming wholesale, or licensed text.
- Do not introduce SQLite, a database dependency, or file-backed JSON storage for this version.
- Do not store prompts, terminal output, pane preview text, command transcript, HTTP API payloads, model responses, or clipboard/image data.
- Do not duplicate live session ownership outside `InstanceStore`, `TmuxSessionManager`, `ZellijSessionManager`, and `TerminalDashboardProvider` discovery results.
- Do not overwrite or revert dirty project-list/dashboard changes already present in `package.json`, `src/types.ts`, `src/providers/TerminalDashboardProvider.ts`, `src/webview/dashboard-manager.tsx`, `src/webview/dashboard/components/App.tsx`, or related tests.
- Do not retrofit the legacy inline `openDashboardInEditor` implementation in `src/core/commands/dashboardCommands.ts` beyond command/manifest tests unless the executor first confirms it is still actively used; this plan targets the `TerminalDashboardProvider` dashboard.
- Do not add Node APIs to `src/webview/**`.
- Do not rely on generated `dist/`, `out/`, or `coverage/` as source.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD + Vitest unit/jsdom tests, manifest tests when command contributions change, and VS Code e2e/manual QA after implementation
- QA policy: every task has agent-executed scenarios
- Evidence: `.omo/evidence/zed-thread-manager/task-<N>-<slug>.<ext>`
- Evidence command policy: every command that pipes to `tee` must be run as `bash -o pipefail -c '<command> 2>&1 | tee <evidence>'` so failed tests/builds fail the scenario.

## Execution strategy
### Parallel execution waves
> Target 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks to maximize parallelism.

Wave 1 (no dependencies):
- Task 1: Preserve dirty worktree boundaries and create RED evidence harness
- Task 2: Add shared thread-history contracts
- Task 4: Add dashboard browser thread-history contracts

Wave 2 (after Wave 1):
- Task 3: depends [2] - Add thread-history persistence service
- Task 7: depends [4] - Wire webview bridge and local view state
- Task 8: depends [4] - Add Preact history UI and CSS

Wave 3 (after Wave 2):
- Task 5: depends [2, 3] - Wire provider/lifecycle payload assembly

Wave 4 (after Wave 3):
- Task 6: depends [2, 3, 5] - Wire provider actions and command surface

Wave 5 (after Wave 4):
- Task 9: depends [5, 6, 7, 8] - Add VS Code e2e and tmux manual QA scenarios

Provider edits are intentionally dependency-limited after Wave 2; do not parallelize provider payload and action edits because both touch the same switch/payload code.

Critical path: Task 2 -> Task 3 -> Task 5 -> Task 6 -> Task 9

### Dependency matrix
| Task | Depends on | Blocks | Can parallelize with |
|------|------------|--------|----------------------|
| 1    | none       | 9      | 2, 4                 |
| 2    | none       | 3, 5, 6 | 1, 4                |
| 3    | 2          | 5, 6   | 7, 8                 |
| 4    | none       | 7, 8   | 1, 2, 3              |
| 5    | 2, 3       | 6, 9   | 7, 8                 |
| 6    | 2, 3, 5    | 9      | 7, 8                 |
| 7    | 4          | 9      | 3, 5, 6, 8           |
| 8    | 4          | 9      | 3, 5, 6, 7           |
| 9    | 5, 6, 7, 8 | final  | none                 |

## Todos
> Implementation + Test = ONE task. Never separate.
> Every task MUST have: References + Acceptance Criteria + QA Scenarios + Commit.

- [ ] 1. Preserve dirty worktree boundaries and create RED evidence harness

  What to do: Before touching source files, record the current dirty state and create the evidence directory. Add a short executor note in `.omo/evidence/zed-thread-manager/preflight-status.txt` that lists which files were already dirty and which task-owned files this executor will edit. This task is a guardrail task; it does not change product code.
  Must NOT do: Do not stage, reset, checkout, revert, format, or rewrite any dirty file. Do not edit `dist/`, `out/`, `coverage/`, or existing plan files.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [9] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `AGENTS.md:1` - user requires voice questions through Spokenly; do not ask plain-text questions while executing
  - Pattern:  `package.json:636` - source scripts are available without touching generated outputs
  - Pattern:  `vitest.config.ts:3` - Vitest config and source test include rules
  - Pattern:  current `git status --short` showed many dirty source/docs/package files; treat all preexisting changes as user-owned

  Acceptance criteria (agent-executable only):
  - [ ] `mkdir -p .omo/evidence/zed-thread-manager && git status --short > .omo/evidence/zed-thread-manager/preflight-status.txt`
  - [ ] `test -s .omo/evidence/zed-thread-manager/preflight-status.txt`
  - [ ] No source file diff is introduced by this task: `git diff --name-only -- . ':!plans/zed-thread-manager.md' ':!.omo/evidence/zed-thread-manager/preflight-status.txt'`

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: dirty state captured
    Tool:     bash
    Steps:    mkdir -p .omo/evidence/zed-thread-manager && git status --short > .omo/evidence/zed-thread-manager/task-1-preflight.txt && test -s .omo/evidence/zed-thread-manager/task-1-preflight.txt
    Expected: .omo/evidence/zed-thread-manager/task-1-preflight.txt exists and contains the preexisting dirty file list
    Evidence: .omo/evidence/zed-thread-manager/task-1-preflight.txt

  Scenario: no product mutation from preflight
    Tool:     bash
    Steps:    git diff --name-only -- . ':!plans/zed-thread-manager.md' ':!.omo/evidence/zed-thread-manager/**' > .omo/evidence/zed-thread-manager/task-1-diff-scope.txt
    Expected: task-1-diff-scope.txt contains only preexisting dirty paths, not files created by Task 1
    Evidence: .omo/evidence/zed-thread-manager/task-1-diff-scope.txt
  ```

  Commit: NO | Message: `n/a` | Files: [.omo/evidence/zed-thread-manager/preflight-status.txt]

- [ ] 2. Add shared thread-history contracts

  What to do: Write RED tests in `src/types.test.ts` for the new host-side contract, then add types in `src/types.ts`. Add these exact exports: `ThreadHistoryBackend`, `ThreadHistoryStatus`, `ThreadHistoryRecord`, `ThreadHistoryEntryDto`, `ThreadHistoryScope`, `ThreadHistoryViewMode`, and `ThreadHistoryActionMessage`. Extend `TmuxDashboardActionMessage` with `toggleThreadHistory`, `filterThreadHistory`, `activateThreadHistoryEntry`, `archiveThreadHistoryEntry`, `restoreThreadHistoryEntry`, `deleteThreadHistoryEntry`, and `renameThreadHistoryEntry`. Extend `TmuxDashboardHostMessage` `updateTmuxSessions` payload with `threadHistory`, `threadHistoryMode`, and `threadHistoryFilter`. Keep existing `updateTmuxSessions` name for backward compatibility; do not rename it in this task.
  Must NOT do: Do not add persistence logic, provider logic, or webview rendering in this task. Do not remove existing tmux/zellij/native dashboard fields.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [3, 5, 6] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `src/types.ts:271` - existing dashboard action union to extend
  - Pattern:  `src/types.ts:334` - existing `TmuxDashboardSessionDto` shape to keep compatible
  - Pattern:  `src/types.ts:368` - existing `TmuxDashboardHostMessage` `updateTmuxSessions` payload to extend
  - Pattern:  `src/types.test.ts:1` - existing type-level regression style
  - External: `https://github.com/zed-industries/zed/blob/818244003b6db179ae175ae3171c8d7f2846e732/crates/agent_ui/src/thread_metadata_store.rs#L309` - conceptual metadata fields only; do not copy struct

  Acceptance criteria (agent-executable only):
  - [ ] RED evidence exists: `npm run test -- src/types.test.ts 2>&1 | tee .omo/evidence/zed-thread-manager/task-2-types-red.txt` fails before implementation because the new exported types/actions do not exist
  - [ ] GREEN evidence exists: `npm run test -- src/types.test.ts 2>&1 | tee .omo/evidence/zed-thread-manager/task-2-types-green.txt` passes after implementation
  - [ ] `src/types.ts` exports the exact names listed in What to do
  - [ ] `ThreadHistoryRecord` does not contain fields named `prompt`, `output`, `transcript`, `preview`, `messages`, or `response`

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: new contract compiles and preserves old dashboard payload
    Tool:     bash
    Steps:    npm run test -- src/types.test.ts 2>&1 | tee .omo/evidence/zed-thread-manager/task-2-types-green.txt
    Expected: command exits 0 and tests cover both old `updateTmuxSessions` payloads and new `threadHistory` payloads
    Evidence: .omo/evidence/zed-thread-manager/task-2-types-green.txt

  Scenario: privacy fields are absent
    Tool:     bash
    Steps:    node -e "const fs=require('fs'); const s=fs.readFileSync('src/types.ts','utf8'); const bad=['prompt','output','transcript','messages','response']; const block=s.slice(s.indexOf('ThreadHistoryRecord'), s.indexOf('ThreadHistoryActionMessage')); for (const b of bad) if (block.includes(b)) throw new Error('forbidden field '+b); console.log('privacy field scan passed');" 2>&1 | tee .omo/evidence/zed-thread-manager/task-2-privacy.txt
    Expected: command exits 0 with no forbidden history fields
    Evidence: .omo/evidence/zed-thread-manager/task-2-privacy.txt
  ```

  Commit: YES | Message: `feat(types): add thread history dashboard contracts` | Files: [src/types.ts, src/types.test.ts]

- [ ] 3. Add thread-history persistence service

  What to do: Write RED tests in `src/services/ThreadHistoryStore.test.ts`, then implement `src/services/ThreadHistoryStore.ts`. The service must accept `vscode.ExtensionContext`, load from `globalState.get("ulw.threadHistory.v1")`, sanitize malformed records, persist with `globalState.update`, and expose deterministic methods: `list(scope)`, `upsertObserved(records, now)`, `archive(id)`, `restore(id)`, `delete(id)`, `rename(id, titleOverride)`, `touchInteracted(id, now)`, and `toDashboardEntries(scope, observedIds)`. Sorting must be `interactedAt desc`, then `updatedAt desc`, then `createdAt desc`, then `title asc`. Filter out records with `parentThreadId` from top-level dashboard entries unless `includeChildren` is true. Enforce a 300-record cap after each write and drop oldest closed archived records first.
  Must NOT do: Do not call tmux/zellij managers, do not inspect terminals, do not persist previews/output/prompts, and do not mutate `InstanceStore`.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [5, 6] | Blocked by: [2]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `src/services/InstanceRegistry.ts:5` - existing VS Code state key constants and migration style
  - Pattern:  `src/services/InstanceRegistry.ts:81` - existing `globalState.update` / `workspaceState.update` persistence pattern
  - Pattern:  `src/services/InstanceRegistry.ts:197` - sanitize unknown persisted values before using them
  - Pattern:  `src/services/InstanceStore.ts:230` - clone records on read/write to prevent external mutation
  - Pattern:  `src/services/SessionWindowHandoffService.ts:3` - small explicit global-state record owner pattern
  - External: `https://github.com/zed-industries/zed/blob/818244003b6db179ae175ae3171c8d7f2846e732/crates/agent/src/thread_store.rs#L103` - conceptual reload/list cache pattern only
  - External: `https://github.com/zed-industries/zed/blob/818244003b6db179ae175ae3171c8d7f2846e732/crates/agent/src/db.rs#L522` - conceptual newest-first metadata listing only

  Acceptance criteria (agent-executable only):
  - [ ] RED evidence exists: `npm run test -- src/services/ThreadHistoryStore.test.ts 2>&1 | tee .omo/evidence/zed-thread-manager/task-3-store-red.txt` fails before implementation
  - [ ] GREEN evidence exists: `npm run test -- src/services/ThreadHistoryStore.test.ts 2>&1 | tee .omo/evidence/zed-thread-manager/task-3-store-green.txt` passes after implementation
  - [ ] Malformed persisted entries are ignored without throwing
  - [ ] `globalState.update("ulw.threadHistory.v1", ...)` is called only with sanitized records
  - [ ] Tests prove forbidden privacy fields are not preserved when present in stored unknown input
  - [ ] Tests prove observed live entries are marked available and unobserved entries remain as closed history

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: persistence and sorting
    Tool:     bash
    Steps:    npm run test -- src/services/ThreadHistoryStore.test.ts 2>&1 | tee .omo/evidence/zed-thread-manager/task-3-store-green.txt
    Expected: command exits 0 and includes tests for load, sanitize, upsert, archive, restore, delete, rename, cap, and sorting
    Evidence: .omo/evidence/zed-thread-manager/task-3-store-green.txt

  Scenario: corrupt state is nonfatal
    Tool:     bash
    Steps:    npm run test -- src/services/ThreadHistoryStore.test.ts -t "ignores malformed persisted records" 2>&1 | tee .omo/evidence/zed-thread-manager/task-3-store-corrupt.txt
    Expected: command exits 0 and malformed records do not throw
    Evidence: .omo/evidence/zed-thread-manager/task-3-store-corrupt.txt
  ```

  Commit: YES | Message: `feat(services): persist lightweight thread history` | Files: [src/services/ThreadHistoryStore.ts, src/services/ThreadHistoryStore.test.ts]

- [ ] 4. Add dashboard browser thread-history contracts

  What to do: Write RED tests for browser DTO usage in `src/webview/dashboard/types.test.ts` or extend the closest existing dashboard test if a new test file conflicts with local conventions, then update `src/webview/dashboard/types.ts`. Mirror the host DTO names needed by webview rendering: `ThreadHistoryEntryDto`, `ThreadHistoryViewMode`, and `ThreadHistoryAction`. Extend `DashboardPayload` with `threadHistory`, `threadHistoryMode`, and `threadHistoryFilter`. Extend `HostMessage` with those fields. Keep browser-only types free of Node imports.
  Must NOT do: Do not import from `src/types.ts` into webview code if that creates host-only coupling. Do not add Node APIs to `src/webview/**`.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [7, 8] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `src/webview/dashboard/types.ts:5` - browser dashboard DTO duplication pattern
  - Pattern:  `src/webview/dashboard/types.ts:38` - `DashboardPayload` fields to extend
  - Pattern:  `src/webview/dashboard/types.ts:56` - `HostMessage` fields to extend
  - Pattern:  `src/webview/dashboard/components/App.test.ts:1` - jsdom environment marker for webview component tests
  - Guardrail: `AGENTS.md` anti-pattern says no Node APIs in `src/webview`

  Acceptance criteria (agent-executable only):
  - [ ] RED evidence exists: `npm run test -- src/webview/dashboard/types.test.ts 2>&1 | tee .omo/evidence/zed-thread-manager/task-4-webview-types-red.txt` fails before implementation, or the chosen existing dashboard test file fails with equivalent missing types
  - [ ] GREEN evidence exists: `npm run test -- src/webview/dashboard/types.test.ts 2>&1 | tee .omo/evidence/zed-thread-manager/task-4-webview-types-green.txt` passes after implementation, or equivalent chosen dashboard test file passes
  - [ ] `src/webview/dashboard/types.ts` contains no imports from `fs`, `path`, `os`, `child_process`, `vscode`, or `src/types.ts`

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: browser DTOs compile
    Tool:     bash
    Steps:    npm run test -- src/webview/dashboard/types.test.ts 2>&1 | tee .omo/evidence/zed-thread-manager/task-4-webview-types-green.txt
    Expected: command exits 0; if no dedicated types test is kept, replace with the exact dashboard test file used by the executor and note it in the evidence
    Evidence: .omo/evidence/zed-thread-manager/task-4-webview-types-green.txt

  Scenario: webview remains browser-only
    Tool:     bash
    Steps:    node -e "const fs=require('fs'); const path=require('path'); const out='.omo/evidence/zed-thread-manager/task-4-webview-node-scan.txt'; const forbidden=/(from ['\"](fs|path|os|child_process|vscode|\\.\\.\\/\\.\\.\\/types)|require\\(['\"](fs|path|os|child_process|vscode))/; const hits=[]; function walk(dir){ for (const name of fs.readdirSync(dir)){ const p=path.join(dir,name); const st=fs.statSync(p); if(st.isDirectory()) walk(p); else if(/\\.(ts|tsx|js|jsx)$/.test(p)){ const s=fs.readFileSync(p,'utf8'); if(forbidden.test(s)) hits.push(p); } } } walk('src/webview'); fs.writeFileSync(out,hits.join('\\n')); if(hits.length) throw new Error(hits.join('\\n'));"
    Expected: evidence file has no matches
    Evidence: .omo/evidence/zed-thread-manager/task-4-webview-node-scan.txt
  ```

  Commit: YES | Message: `feat(webview): add thread history dashboard types` | Files: [src/webview/dashboard/types.ts, src/webview/dashboard/types.test.ts]

- [ ] 5. Wire provider/lifecycle payload assembly

  What to do: Write RED tests in `src/providers/TerminalDashboardProvider.test.ts` and `src/core/ExtensionLifecycle.test.ts`, then wire `ThreadHistoryStore` into `ExtensionLifecycle` and `TerminalDashboardProvider`. `ExtensionLifecycle` must instantiate one `ThreadHistoryStore(context)` after `InstanceRegistry` hydration and pass it into `TerminalDashboardProvider`. `TerminalDashboardProvider.postSessionsToWebview()` must build observed history records from filtered tmux/zellij sessions and native shells, call `threadHistoryStore.upsertObserved(...)`, and include `threadHistory`, `threadHistoryMode`, and `threadHistoryFilter` in the `updateTmuxSessions` payload. Live observed records must include pane count/tool names in DTO only, not persisted records.
  Must NOT do: Do not duplicate live session state in the store. Do not persist pane previews, command lines, or terminal output. Do not remove current session/native-shell payload fields.

  Parallelization: Can parallel: YES | Wave 3 | Blocks: [6, 9] | Blocked by: [2, 3]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `src/core/ExtensionLifecycle.ts:123` - manual DI service creation
  - Pattern:  `src/core/ExtensionLifecycle.ts:240` - `TerminalDashboardProvider` construction and dependency injection
  - Pattern:  `src/providers/TerminalDashboardProvider.ts:132` - `postSessionsToWebview()` payload assembly
  - Pattern:  `src/providers/TerminalDashboardProvider.ts:184` - panes/windows maps derived from live managers
  - Pattern:  `src/providers/TerminalDashboardProvider.ts:226` - current session DTO payload
  - Pattern:  `src/providers/TerminalDashboardProvider.ts:235` - native shell DTO integration
  - Pattern:  `src/providers/TerminalDashboardProvider.ts:957` - native shells already derive from `InstanceStore`
  - Test:     `src/providers/TerminalDashboardProvider.test.ts:199` - existing payload assertion style
  - Test:     `src/core/ExtensionLifecycle.test.ts:29` - activation/DI test setup
  - External: `https://github.com/zed-industries/zed/blob/818244003b6db179ae175ae3171c8d7f2846e732/crates/agent_ui/src/thread_metadata_store.rs#L657` - conceptual reload into cached metadata only

  Acceptance criteria (agent-executable only):
  - [ ] RED evidence exists: `npm run test -- src/providers/TerminalDashboardProvider.test.ts src/core/ExtensionLifecycle.test.ts 2>&1 | tee .omo/evidence/zed-thread-manager/task-5-provider-red.txt` fails before implementation
  - [ ] GREEN evidence exists: `npm run test -- src/providers/TerminalDashboardProvider.test.ts src/core/ExtensionLifecycle.test.ts 2>&1 | tee .omo/evidence/zed-thread-manager/task-5-provider-green.txt` passes after implementation
  - [ ] Provider tests prove tmux, zellij, and native shell entries are emitted with stable ids and active/available states
  - [ ] Provider tests prove `showingAll` controls history scope consistently with sessions
  - [ ] Provider tests prove missing/corrupt store data still posts sessions with empty `threadHistory`

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: dashboard payload includes thread history
    Tool:     bash
    Steps:    npm run test -- src/providers/TerminalDashboardProvider.test.ts -t "thread history" 2>&1 | tee .omo/evidence/zed-thread-manager/task-5-provider-history.txt
    Expected: command exits 0 and validates tmux, zellij, native, current workspace, and all-project history payloads
    Evidence: .omo/evidence/zed-thread-manager/task-5-provider-history.txt

  Scenario: activation wires the service once
    Tool:     bash
    Steps:    npm run test -- src/core/ExtensionLifecycle.test.ts -t "ThreadHistoryStore" 2>&1 | tee .omo/evidence/zed-thread-manager/task-5-lifecycle.txt
    Expected: command exits 0 and proves one store instance is passed to TerminalDashboardProvider
    Evidence: .omo/evidence/zed-thread-manager/task-5-lifecycle.txt
  ```

  Commit: YES | Message: `feat(dashboard): publish thread history entries` | Files: [src/core/ExtensionLifecycle.ts, src/core/ExtensionLifecycle.test.ts, src/providers/TerminalDashboardProvider.ts, src/providers/TerminalDashboardProvider.test.ts]

- [ ] 6. Wire provider actions and command surface

  What to do: Write RED tests in `src/providers/TerminalDashboardProvider.test.ts`, `src/__tests__/manifest-branding.test.ts`, and command tests if package contributions change. Add provider state fields `threadHistoryMode: "current" | "history"` and `threadHistoryFilter: string`. Add action handling for `toggleThreadHistory`, `filterThreadHistory`, `activateThreadHistoryEntry`, `archiveThreadHistoryEntry`, `restoreThreadHistoryEntry`, `deleteThreadHistoryEntry`, and `renameThreadHistoryEntry`. Activation must reuse existing `openSessionInNewWindow` behavior when the entry is live and has a workspace URI; closed entries without a live target must show a warning and remain in history. Rename must use `vscode.window.showInputBox` and store `titleOverride` only. Add command `ulw.toggleThreadHistory` only if the package/manifest task can preserve dirty package changes; command callback calls `TerminalDashboardProvider.toggleThreadHistory()` and refreshes the dashboard.
  Must NOT do: Do not spawn tmux/zellij/native sessions for closed history entries in this version. Do not delete live tmux/zellij sessions when deleting a history record; delete only metadata unless the existing kill-session action is used.

  Parallelization: Can parallel: YES | Wave 4 | Blocks: [9] | Blocked by: [2, 3, 5]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `src/providers/TerminalDashboardProvider.ts:396` - action switch to extend
  - Pattern:  `src/providers/TerminalDashboardProvider.ts:412` - existing activate action and workspace URI warning
  - Pattern:  `src/providers/TerminalDashboardProvider.ts:713` - existing action that touches tool/session interaction
  - Pattern:  `src/providers/TerminalDashboardProvider.ts:730` - existing kill-session behavior to keep distinct from history delete
  - Pattern:  `src/test/mocks/vscode.ts:9` - mocked `showWarningMessage`
  - Pattern:  `src/test/mocks/vscode.ts:29` - mocked `showInputBox`
  - Pattern:  `package.json:55` - command contribution list if adding `ulw.toggleThreadHistory`
  - Test:     `src/__tests__/manifest-branding.test.ts:1` - manifest assertion pattern
  - External: `https://github.com/zed-industries/zed/blob/818244003b6db179ae175ae3171c8d7f2846e732/crates/agent_ui/src/thread_metadata_store.rs#L701` - title override concept only
  - External: `https://github.com/zed-industries/zed/blob/818244003b6db179ae175ae3171c8d7f2846e732/crates/sidebar/src/sidebar.rs#L7092` - history toggle concept only

  Acceptance criteria (agent-executable only):
  - [ ] RED evidence exists: `npm run test -- src/providers/TerminalDashboardProvider.test.ts src/__tests__/manifest-branding.test.ts 2>&1 | tee .omo/evidence/zed-thread-manager/task-6-actions-red.txt` fails before implementation
  - [ ] GREEN evidence exists: `npm run test -- src/providers/TerminalDashboardProvider.test.ts src/__tests__/manifest-branding.test.ts 2>&1 | tee .omo/evidence/zed-thread-manager/task-6-actions-green.txt` passes after implementation
  - [ ] Tests prove archive hides entries from current view and restore returns them to current view if live
  - [ ] Tests prove delete removes metadata but does not call `ulw.killTmuxSession`
  - [ ] Tests prove rename stores title override and empty/cancelled input does not mutate
  - [ ] Tests prove closed entry activation shows warning instead of spawning a new session

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: metadata actions do not kill live sessions
    Tool:     bash
    Steps:    npm run test -- src/providers/TerminalDashboardProvider.test.ts -t "history delete" 2>&1 | tee .omo/evidence/zed-thread-manager/task-6-delete-no-kill.txt
    Expected: command exits 0 and asserts `ulw.killTmuxSession` is not called for history deletion
    Evidence: .omo/evidence/zed-thread-manager/task-6-delete-no-kill.txt

  Scenario: command contribution remains valid
    Tool:     bash
    Steps:    npm run test -- src/__tests__/manifest-branding.test.ts 2>&1 | tee .omo/evidence/zed-thread-manager/task-6-manifest.txt
    Expected: command exits 0 and package manifest assertions pass with the new command if added
    Evidence: .omo/evidence/zed-thread-manager/task-6-manifest.txt
  ```

  Commit: YES | Message: `feat(dashboard): manage thread history actions` | Files: [src/providers/TerminalDashboardProvider.ts, src/providers/TerminalDashboardProvider.test.ts, package.json, src/__tests__/manifest-branding.test.ts, src/core/ExtensionLifecycle.ts, src/core/ExtensionLifecycle.test.ts]

- [ ] 7. Wire webview bridge and local view state

  What to do: Write RED tests in `src/webview/dashboard-manager.test.ts`, then update `src/webview/dashboard-manager.tsx`. Normalize `threadHistory`, `threadHistoryMode`, and `threadHistoryFilter` from host messages into `lastPayload`. Add click/input handlers for history toggle, filter, activate, archive, restore, delete, and rename actions. Preserve existing action deduping via `pendingActionKeys`. Use debounced microtask or direct post for filter updates, but tests must prove duplicate filter posts do not flood on identical values. Keep return banner/session/native/AI/tmux command behavior unchanged.
  Must NOT do: Do not add host-only imports, do not use localStorage, and do not persist dashboard state in the webview.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [9] | Blocked by: [4]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `src/webview/dashboard-manager.tsx:20` - `lastPayload` initialization
  - Pattern:  `src/webview/dashboard-manager.tsx:47` - action deduping via `pendingActionKeys`
  - Pattern:  `src/webview/dashboard-manager.tsx:127` - host message listener
  - Pattern:  `src/webview/dashboard-manager.tsx:136` - payload normalization
  - Pattern:  `src/webview/dashboard-manager.tsx:165` - click delegation
  - Pattern:  `src/webview/dashboard-manager.tsx:287` - existing `data-action` button handling
  - Test:     `src/webview/dashboard-manager.test.ts:36` - jsdom bootstrap and mocked VS Code API

  Acceptance criteria (agent-executable only):
  - [ ] RED evidence exists: `npm run test -- src/webview/dashboard-manager.test.ts 2>&1 | tee .omo/evidence/zed-thread-manager/task-7-webview-red.txt` fails before implementation
  - [ ] GREEN evidence exists: `npm run test -- src/webview/dashboard-manager.test.ts 2>&1 | tee .omo/evidence/zed-thread-manager/task-7-webview-green.txt` passes after implementation
  - [ ] Tests prove incoming history payload renders through App props
  - [ ] Tests prove filter input posts `{ action: "filterThreadHistory", filter: "..." }`
  - [ ] Tests prove history card buttons post the exact provider actions with `threadId`
  - [ ] Existing dashboard activation and AI selector tests still pass

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: webview posts history actions
    Tool:     bash
    Steps:    npm run test -- src/webview/dashboard-manager.test.ts -t "thread history" 2>&1 | tee .omo/evidence/zed-thread-manager/task-7-history-actions.txt
    Expected: command exits 0 and validates toggle, filter, activate, archive, restore, delete, and rename webview posts
    Evidence: .omo/evidence/zed-thread-manager/task-7-history-actions.txt

  Scenario: existing dashboard card activation unchanged
    Tool:     bash
    Steps:    npm run test -- src/webview/dashboard-manager.test.ts -t "project activation" 2>&1 | tee .omo/evidence/zed-thread-manager/task-7-existing-activation.txt
    Expected: command exits 0 and existing session card activation still posts one activate action with workspace URI
    Evidence: .omo/evidence/zed-thread-manager/task-7-existing-activation.txt
  ```

  Commit: YES | Message: `feat(webview): route thread history dashboard actions` | Files: [src/webview/dashboard-manager.tsx, src/webview/dashboard-manager.test.ts]

- [ ] 8. Add Preact history UI and CSS

  What to do: Write RED tests in `src/webview/dashboard/components/App.test.ts`, then add components under `src/webview/dashboard/components/ThreadHistoryPanel.tsx` and `ThreadHistoryCard.tsx` or equivalent. Update `App.tsx` to render current sessions/native shells when `threadHistoryMode === "current"` and history when `threadHistoryMode === "history"`. Add a compact filter input in history mode, row-level status badges, title override display, workspace/backend metadata, and action buttons. Update `src/webview/dashboard.css` for stable dimensions, no nested cards, no decorative gradients/orbs, and no text overflow. Use simple text/icon labels available in VS Code webview CSS; do not add an icon dependency unless one already exists in the webview bundle.
  Must NOT do: Do not create a landing page, hero, decorative card stacks, or browser-only explanatory text. Do not make cards inside cards. Do not use viewport-scaled font sizes or negative letter spacing.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [9] | Blocked by: [4]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `src/webview/dashboard/components/App.tsx:14` - top-level Preact dashboard composition
  - Pattern:  `src/webview/dashboard/components/SessionCard.tsx:41` - existing dashboard card structure and action callbacks
  - Pattern:  `src/webview/dashboard/components/NativeShellCard.tsx:21` - simpler native-shell row/card pattern
  - Pattern:  `src/webview/dashboard/components/EmptyState.tsx` - empty-state component style
  - Pattern:  `src/webview/dashboard/utils.ts` - HTML escaping and badge utility pattern
  - Pattern:  `src/webview/dashboard.css:48` - existing visual primitives for dashboard rows/cards
  - Test:     `src/webview/dashboard/components/App.test.ts:24` - component action forwarding test pattern
  - External: `https://github.com/zed-industries/zed/blob/818244003b6db179ae175ae3171c8d7f2846e732/crates/ui/src/components/ai/thread_item.rs#L34` - conceptual row states only
  - External: `https://github.com/zed-industries/zed/blob/818244003b6db179ae175ae3171c8d7f2846e732/crates/sidebar/src/sidebar.rs#L6748` - separate no-results vs empty-state concept only

  Acceptance criteria (agent-executable only):
  - [ ] RED evidence exists: `npm run test -- src/webview/dashboard/components/App.test.ts 2>&1 | tee .omo/evidence/zed-thread-manager/task-8-ui-red.txt` fails before implementation
  - [ ] GREEN evidence exists: `npm run test -- src/webview/dashboard/components/App.test.ts 2>&1 | tee .omo/evidence/zed-thread-manager/task-8-ui-green.txt` passes after implementation
  - [ ] Tests prove current mode still renders sessions/native shells
  - [ ] Tests prove history mode renders history entries, empty history, and no-results separately
  - [ ] Tests prove archived entries show restore/delete but not archive
  - [ ] CSS scan proves no `font-size: .*vw`, no `letter-spacing: -`, and no `border-radius` above 8px in new dashboard history selectors

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: history UI renders actions and filter
    Tool:     bash
    Steps:    npm run test -- src/webview/dashboard/components/App.test.ts -t "thread history" 2>&1 | tee .omo/evidence/zed-thread-manager/task-8-ui-history.txt
    Expected: command exits 0 and validates history rows, filter input, and action callbacks
    Evidence: .omo/evidence/zed-thread-manager/task-8-ui-history.txt

  Scenario: CSS guardrails
    Tool:     bash
    Steps:    bash -o pipefail -c 'if rg -n "font-size:\\s*[^;]*vw|letter-spacing:\\s*-" src/webview/dashboard.css 2>&1 | tee .omo/evidence/zed-thread-manager/task-8-css-scan.txt; then exit 1; else : > .omo/evidence/zed-thread-manager/task-8-css-scan.txt; fi'
    Expected: command exits 0 with no viewport font scaling or negative letter spacing matches
    Evidence: .omo/evidence/zed-thread-manager/task-8-css-scan.txt
  ```

  Commit: YES | Message: `feat(dashboard): render thread history view` | Files: [src/webview/dashboard/components/App.tsx, src/webview/dashboard/components/App.test.ts, src/webview/dashboard/components/ThreadHistoryPanel.tsx, src/webview/dashboard/components/ThreadHistoryCard.tsx, src/webview/dashboard.css]

- [ ] 9. Add VS Code e2e and tmux manual QA scenarios

  What to do: Add or update focused e2e coverage only where it is agent-executable: `src/test/e2e/suite/webview.e2e.ts` for command/view availability and `src/test/e2e/suite/contributions.e2e.ts` if a new command contribution is added. Then execute full verification commands and tmux manual QA. Manual QA must create two tmux sessions, open the Extension Development Host, open ULW Terminal Manager, switch to History, filter one entry, archive/restore/delete metadata, and capture evidence screenshots/logs. Use `.omo/evidence/zed-thread-manager/` for every artifact.
  Must NOT do: Do not mark manual QA passed from unit tests alone. Do not skip tmux QA if tmux is installed. If tmux is unavailable, capture `tmux -V` failure and mark the scenario blocked, not passed.

  Parallelization: Can parallel: NO | Wave 5 | Blocks: [final] | Blocked by: [5, 6, 7, 8]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `package.json:642` - unit test command
  - Pattern:  `package.json:643` - e2e pretest compiles extension and e2e suite
  - Pattern:  `package.json:644` - VS Code e2e command
  - Pattern:  `src/test/e2e/suite/webview.e2e.ts:1` - webview e2e smoke pattern
  - Pattern:  `src/test/e2e/suite/contributions.e2e.ts:1` - contribution assertion pattern
  - Pattern:  `src/test/e2e/AGENTS.md:1` - e2e suite guidance
  - Pattern:  `src/providers/TerminalDashboardProvider.ts:98` - dashboard opens as WebviewPanel for manual verification
  - External: `https://github.com/zed-industries/zed/blob/818244003b6db179ae175ae3171c8d7f2846e732/crates/sidebar/src/sidebar.rs#L6938` - history toggle concept only

  Acceptance criteria (agent-executable only):
  - [ ] `npm run test 2>&1 | tee .omo/evidence/zed-thread-manager/task-9-unit.txt` exits 0
  - [ ] `npm run lint 2>&1 | tee .omo/evidence/zed-thread-manager/task-9-lint.txt` exits 0
  - [ ] `npm run compile 2>&1 | tee .omo/evidence/zed-thread-manager/task-9-compile.txt` exits 0
  - [ ] `npm run compile:e2e 2>&1 | tee .omo/evidence/zed-thread-manager/task-9-compile-e2e.txt` exits 0
  - [ ] `npm run test:e2e 2>&1 | tee .omo/evidence/zed-thread-manager/task-9-e2e.txt` exits 0, or the failure is unrelated environmental VS Code download/launch failure and is documented with logs
  - [ ] tmux manual QA evidence includes at least one screenshot of current mode, one screenshot of history mode, one log proving archive/restore/delete metadata actions, and `tmux list-sessions` before/after logs proving metadata delete did not kill the live session

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: full automated verification
    Tool:     bash
    Steps:    mkdir -p .omo/evidence/zed-thread-manager && npm run test 2>&1 | tee .omo/evidence/zed-thread-manager/task-9-unit.txt && npm run lint 2>&1 | tee .omo/evidence/zed-thread-manager/task-9-lint.txt && npm run compile 2>&1 | tee .omo/evidence/zed-thread-manager/task-9-compile.txt && npm run compile:e2e 2>&1 | tee .omo/evidence/zed-thread-manager/task-9-compile-e2e.txt
    Expected: all commands exit 0
    Evidence: .omo/evidence/zed-thread-manager/task-9-unit.txt

  Scenario: tmux manual history workflow
    Tool:     computer-use
    Steps:    First run bash setup: `mkdir -p .omo/evidence/zed-thread-manager/manual-workspaces/repo-a .omo/evidence/zed-thread-manager/manual-workspaces/repo-b && tmux kill-session -t ulw-history-a 2>/dev/null || true && tmux kill-session -t ulw-history-b 2>/dev/null || true && tmux new-session -d -s ulw-history-a -c "$PWD/.omo/evidence/zed-thread-manager/manual-workspaces/repo-a" "printf 'ulw-history-a ready\n'; sleep 600" && tmux new-session -d -s ulw-history-b -c "$PWD/.omo/evidence/zed-thread-manager/manual-workspaces/repo-b" "printf 'ulw-history-b ready\n'; sleep 600" && tmux list-sessions > .omo/evidence/zed-thread-manager/task-9-tmux-before.txt`. Then launch Extension Development Host with `code --extensionDevelopmentPath="$PWD" "$PWD/.omo/evidence/zed-thread-manager/manual-workspaces/repo-a"`. In the VS Code window, open command palette, run `ULW: Open Terminal Manager` or `Open Terminal Manager`, verify current mode lists `ulw-history-a`, click History, filter `ulw-history`, archive `ulw-history-a`, restore it, delete only the metadata row for `ulw-history-b`, and capture screenshots after current mode and history mode.
    Expected: current mode lists the live workspace session; history mode lists persisted metadata; archive hides/restores metadata; delete removes metadata only; `tmux list-sessions` after delete still includes live tmux sessions until cleanup
    Evidence: .omo/evidence/zed-thread-manager/task-9-history-current.png

  Scenario: stale closed history entry
    Tool:     bash
    Steps:    tmux kill-session -t ulw-history-b 2>/dev/null || true; tmux list-sessions > .omo/evidence/zed-thread-manager/task-9-tmux-after-kill.txt || true
    Expected: a previously observed `ulw-history-b` history row remains marked closed in the dashboard, and activating it shows the exact warning captured in `.omo/evidence/zed-thread-manager/task-9-closed-warning.png`
    Evidence: .omo/evidence/zed-thread-manager/task-9-tmux-after-kill.txt
  ```

  Commit: YES | Message: `test(dashboard): cover thread history workflows` | Files: [src/test/e2e/suite/webview.e2e.ts, src/test/e2e/suite/contributions.e2e.ts]

## Final verification wave (MANDATORY - after all implementation tasks)
> Runs in PARALLEL. ALL must APPROVE. Surface results to the caller and wait for an explicit "okay" before declaring complete.
- [ ] F1. Plan compliance audit - every task done, every acceptance criterion met
- [ ] F2. Code quality review - diagnostics clean, idioms match, no dead code
- [ ] F3. Real manual QA - every QA scenario executed with evidence captured
- [ ] F4. Scope fidelity - nothing extra shipped beyond Must-Have, nothing Must-NOT-Have introduced

## Commit strategy
- One logical change per commit. Conventional Commits (`<type>(<scope>): <subject>` body + footer).
- Atomic: every commit builds and passes tests on its own.
- No "WIP" / "fix typo squash later" commits on the final branch - clean up before merge.
- Reference the plan file path in the final commit footer: `Plan: plans/zed-thread-manager.md`.

## Success criteria
- All Must-Have shipped; all QA scenarios pass with captured evidence; F1-F4 approved; commit history clean.
