# Terminal Default Location

## TL;DR
> Summary:      Add `ulw.terminal.defaultLocation` so ULW defaults to an editor webview terminal, while the secondary sidebar terminal view is only available when the setting is `sidebar`.
> Deliverables:
> - `package.json` setting and sidebar view `when` gate
> - Provider APIs for configured-location start/focus with editor-panel reuse
> - Command and lifecycle routing that honor editor/sidebar location
> - Unit, e2e, install, and tmux evidence
> - Short README setting docs
> Effort:       Medium
> Risk:         Medium - VS Code may still show the contributed secondary-sidebar container if all child views are hidden by `when`; manual install QA must prove this.

## Scope
### Must have
- Add `ulw.terminal.defaultLocation` as a string setting with enum `["editor", "sidebar"]`, default `"editor"`, and user-facing descriptions.
- Gate the contributed `ulw` secondary-sidebar view with `when: "config.ulw.terminal.defaultLocation == 'sidebar'"`.
- Keep `viewsContainers.secondarySidebar` registration unless VS Code package/schema validation proves a supported `when` field is available on the container itself.
- Make `ulw.start` use the configured default location:
  - `editor`: open or reveal an editor webview terminal, then start the runtime if it is not already started.
  - `sidebar`: preserve current sidebar start behavior.
- Make `ulw.focus` use the configured default location:
  - `editor`: reveal an existing editor terminal panel if one exists; create one only when none exists.
  - `sidebar`: preserve current workbench/sidebar focus behavior.
- Keep explicit `ulw.openTerminalInEditor` behavior: it may keep creating a new editor panel, as currently covered by `src/providers/TerminalProvider.test.ts:2413`.
- Keep explicit `ulw.restoreTerminalToSidebar` behavior independent from the default location.
- Route prompt startup/focus paths in `ExtensionLifecycle.sendPromptToOpenCode()` through the configured-location behavior instead of bypassing it with direct sidebar/runtime startup.
- Gate sidebar `autoStartOnOpen` so a revealed sidebar view does not auto-start when default location is `editor`.
- Treat malformed or unexpected setting values as `"editor"`.
- Preserve existing terminal backend behavior (`native`, `tmux`, `zellij`) and pane/session state ownership in `SessionRuntime`, `InstanceStore`, and `PaneStore`.
- Capture evidence under `evidence/` for RED tests, GREEN tests, e2e, dev install, and tmux manual QA.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- Do not duplicate terminal/session state outside `InstanceStore`, `PaneStore`, or existing runtime helpers.
- Do not add tmux/zellij CLI logic to command modules or providers.
- Do not introduce browser/webview DOM changes unless a failing test proves the terminal renderer needs them.
- Do not remove `ulw.openTerminalInEditor` or `ulw.restoreTerminalToSidebar`.
- Do not change `ulw.terminalBackend` semantics.
- Do not rely on generated `dist/`, `out/`, or `coverage/` as source.
- Do not silently accept a visible secondary-sidebar entry in editor-default mode; if the view gate is insufficient, surface the exact evidence before shipping.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD + Vitest unit tests, VS Code e2e tests, package/schema build, and installed-extension manual QA driven by an agent.
- QA policy: every task has agent-executed scenarios.
- Evidence: `evidence/task-<N>-<slug>.<ext>`

## Execution strategy
### Parallel execution waves
> Target 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks to maximize parallelism.

Wave 1 (no dependencies):
- Task 1: Manifest setting and sidebar view gate
- Task 2: Provider configured-location APIs
- Task 7: Documentation and settings discoverability

Wave 2 (after Wave 1):
- Task 3: Command routing for start/focus/send focus, depends [1, 2]
- Task 4: Extension lifecycle prompt/handoff routing, depends [2]
- Task 6: Sidebar auto-start guard, depends [1, 2]

Wave 3 (after Wave 2):
- Task 5: E2E coverage for contribution and command behavior, depends [1, 3, 4, 6]
- Task 8: Install and tmux manual QA evidence, depends [1, 2, 3, 4, 5, 6, 7]

Critical path: Task 1 -> Task 2 -> Task 3 -> Task 5 -> Task 8

### Dependency matrix
| Task | Depends on | Blocks | Can parallelize with |
|------|------------|--------|----------------------|
| 1    | none       | 3, 5, 6, 8 | 2, 7 |
| 2    | none       | 3, 4, 6, 8 | 1, 7 |
| 3    | 1, 2       | 5, 8 | 4, 6 |
| 4    | 2          | 5, 8 | 3, 6 |
| 5    | 1, 3, 4, 6 | 8 | none |
| 6    | 1, 2       | 5, 8 | 3, 4 |
| 7    | none       | 8 | 1, 2 |
| 8    | 1, 2, 3, 4, 5, 6, 7 | none | none |

## Todos
> Implementation + Test = ONE task. Never separate.
> Every task MUST have: References + Acceptance Criteria + QA Scenarios + Commit.

- [ ] 1. Manifest setting and sidebar view gate

  What to do: First preserve or add RED tests for the new config key and view gate. Existing unstaged tests may already assert part of this in `src/__tests__/manifest-branding.test.ts` and `src/test/e2e/suite/config-comprehensive.e2e.ts`; keep those assertions, then add the missing e2e contribution assertion in `src/test/e2e/suite/contributions.e2e.ts`. Add `ulw.terminal.defaultLocation` to `package.json` near `ulw.terminalBackend`, with default `"editor"`, enum `["editor", "sidebar"]`, enum descriptions, and a description explaining that `sidebar` opts into the secondary sidebar view. Add `when: "config.ulw.terminal.defaultLocation == 'sidebar'"` to the `ulw` view contribution under `contributes.views.ulwContainer`. Do not add `when` to `viewsContainers.secondarySidebar` unless VS Code schema/package validation proves it is supported.
  Must NOT do: Do not rename command IDs, remove the secondary-sidebar container, or change backend settings.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [3, 5, 6, 8] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `package.json:35` - current `viewsContainers.secondarySidebar` contribution for `ulwContainer`.
  - Pattern:  `package.json:44` - current `views.ulwContainer` webview contribution for `ulw`; add the `when` gate here.
  - Pattern:  `package.json:471` - current terminal backend setting; add the new location setting adjacent to this block.
  - Pattern:  `package.json:487` - existing editor/sidebar-adjacent setting `collapseSecondaryBarOnEditorOpen`.
  - Test:     `src/__tests__/manifest-branding.test.ts:131` - existing RED-style assertion for default editor and sidebar opt-in.
  - Test:     `src/test/e2e/suite/config-comprehensive.e2e.ts:53` - authoritative config-property matrix.
  - Test:     `src/test/e2e/suite/contributions.e2e.ts:102` - e2e terminal view metadata assertion; extend `ViewContribution` with `when`.
  - External: `https://code.visualstudio.com/api/references/when-clause-contexts` - official docs for `config.<setting>` in when clauses.
  - External: `https://code.visualstudio.com/api/references/contribution-points` - official docs for view contribution `when` support.

  Acceptance criteria (agent-executable only):
  - [ ] Before manifest implementation, `npm run test -- src/__tests__/manifest-branding.test.ts` fails on the missing setting or missing `when` gate, with output captured in `evidence/task-1-manifest-config-red.txt`.
  - [ ] `package.json` contains exactly one `ulw.terminal.defaultLocation` property with type `string`, default `editor`, and enum values `editor` and `sidebar`.
  - [ ] `package.json` has `contributes.views.ulwContainer[0].when === "config.ulw.terminal.defaultLocation == 'sidebar'"`.
  - [ ] `npm run test -- src/__tests__/manifest-branding.test.ts` passes after the manifest change.
  - [ ] `npm run compile:e2e` passes after e2e type updates.

  QA scenarios (MANDATORY - task incomplete without these):
  > Name the exact tool AND its exact invocation - not "verify it works". Browser use: use Chrome to drive the page; if Chrome is not available, download and use agent-browser (https://github.com/vercel-labs/agent-browser). Computer use: OS-level GUI automation for a non-browser desktop app.
  ```
  Scenario: manifest exposes editor default and sidebar opt-in
    Tool:     bash
    Steps:    mkdir -p evidence && npm run test -- src/__tests__/manifest-branding.test.ts > evidence/task-1-manifest-config.txt 2>&1
    Expected: exit code 0; evidence contains "package manifest branding" and no failed tests
    Evidence: evidence/task-1-manifest-config.txt

  Scenario: package JSON has no malformed or duplicate location setting
    Tool:     bash
    Steps:    node -e "const p=require('./package.json'); const props=p.contributes.configuration.properties; const view=p.contributes.views.ulwContainer.find(v=>v.id==='ulw'); if(!props['ulw.terminal.defaultLocation']) throw new Error('missing setting'); if(props['ulw.terminal.defaultLocation'].default!=='editor') throw new Error('bad default'); if(JSON.stringify(props['ulw.terminal.defaultLocation'].enum)!==JSON.stringify(['editor','sidebar'])) throw new Error('bad enum'); if(view.when!==\"config.ulw.terminal.defaultLocation == 'sidebar'\") throw new Error('bad view when'); console.log('manifest location setting ok')" > evidence/task-1-manifest-config-error.txt 2>&1
    Expected: exit code 0; evidence contains "manifest location setting ok"
    Evidence: evidence/task-1-manifest-config-error.txt
  ```

  Commit: YES | Message: `feat(manifest): add configurable terminal default location` | Files: [`package.json`, `src/__tests__/manifest-branding.test.ts`, `src/test/e2e/suite/contributions.e2e.ts`, `src/test/e2e/suite/config-comprehensive.e2e.ts`, `src/test/e2e/suite/commands.e2e.ts`]

- [ ] 2. Provider configured-location APIs

  What to do: Add a type-safe provider-level implementation for configured terminal location. Introduce `TerminalDefaultLocation = "editor" | "sidebar"` in `src/types.ts` or a narrow provider-local type, and add a helper that reads `workspace.getConfiguration("ulw").get("terminal.defaultLocation", "editor")`, returning `"editor"` for invalid values. Add provider APIs such as `startAtConfiguredLocation()` and `focusAtConfiguredLocation()` (exact names may differ, but commands and lifecycle must use one provider-owned path). For editor default, reveal an existing editor panel before creating one; only create a panel if `editorPanels` is empty. For start, after opening/revealing the editor panel, call `startOpenCode()` if the runtime is not already started. For sidebar default, preserve current `startOpenCode()` and workbench/sidebar focus behavior. Keep `openInEditorTab()` explicit behavior creating another panel unless it is called through the new reuse path.
  Must NOT do: Do not move backend launch logic out of `SessionRuntime`; do not change `openTerminalInEditor` duplicate-panel behavior covered by existing tests.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [3, 4, 6, 8] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `src/providers/TerminalProvider.ts:277` - current `focus()` reveals `_panel` and posts `focusTerminal`.
  - Pattern:  `src/providers/TerminalProvider.ts:301` - current `openInEditorTab()` creates a webview panel in `ViewColumn.Beside`.
  - Pattern:  `src/providers/TerminalProvider.ts:373` - current provider `startOpenCode()` delegates to `SessionRuntime`.
  - Pattern:  `src/providers/TerminalProvider.ts:920` - private `isStarted()` exists; use it inside provider-owned start routing.
  - Pattern:  `src/providers/TerminalProvider.ts:1215` - `initializeEditorPanel()` tracks `editorPanels` and `_panel`.
  - Pattern:  `src/providers/TerminalProvider.ts:1252` - sidebar reveal helper for restoring/focusing sidebar.
  - API/Type: `src/types.ts:528` - `ExtensionConfig` shape; add `'terminal.defaultLocation'` if config shape is updated.
  - Test:     `src/providers/TerminalProvider.test.ts:66` - configuration mock helper; extend it with `terminalDefaultLocation`.
  - Test:     `src/providers/TerminalProvider.test.ts:2345` - editor panel creation and lock-group assertions.
  - Test:     `src/providers/TerminalProvider.test.ts:2413` - repeated explicit editor opens create another panel; preserve this for explicit command only.
  - External: `https://code.visualstudio.com/api/references/vscode-api#window.createWebviewPanel` - official API reference for `createWebviewPanel`.
  - External: `https://code.visualstudio.com/api/references/vscode-api#WebviewPanel` - official API reference for panel reveal/dispose lifecycle.

  Acceptance criteria (agent-executable only):
  - [ ] RED test exists in `src/providers/TerminalProvider.test.ts` showing editor default `startAtConfiguredLocation()` opens/reveals an editor panel and starts the runtime.
  - [ ] RED test exists showing editor default focus reveals an existing editor panel without creating a duplicate.
  - [ ] RED test exists showing invalid `terminal.defaultLocation` falls back to editor.
  - [ ] Existing explicit `openInEditorTab()` duplicate-panel test still passes.
  - [ ] `npm run test -- src/providers/TerminalProvider.test.ts` passes.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: provider starts editor default without duplicating focused panels
    Tool:     bash
    Steps:    mkdir -p evidence && npm run test -- src/providers/TerminalProvider.test.ts > evidence/task-2-provider-location.txt 2>&1
    Expected: exit code 0; evidence includes tests for configured editor start/focus and existing explicit editor-panel behavior
    Evidence: evidence/task-2-provider-location.txt

  Scenario: provider falls back to editor for malformed setting
    Tool:     bash
    Steps:    npm run test -- src/providers/TerminalProvider.test.ts -t "invalid terminal.defaultLocation" > evidence/task-2-provider-location-error.txt 2>&1
    Expected: exit code 0; evidence shows malformed setting test passed
    Evidence: evidence/task-2-provider-location-error.txt
  ```

  Commit: YES | Message: `feat(provider): route terminal lifecycle by default location` | Files: [`src/providers/TerminalProvider.ts`, `src/providers/TerminalProvider.test.ts`, `src/types.ts`]

- [ ] 3. Command routing for start/focus/send focus

  What to do: Update `src/core/commands/terminalCommands.ts` so command handlers use the provider configured-location APIs from Task 2. `ulw.start` must call the provider start-at-configured-location path. `ulw.focus` must call the provider focus-at-configured-location path for editor/sidebar, falling back to the existing `workbench.view.focus` only when no provider API is available and sidebar behavior is requested. Rename `focusSidebarIfConfigured()` to a neutral helper such as `focusTerminalIfConfigured()` and keep all send commands using `ulw.focus`, so `autoFocusOnSend` honors the configured default location. Update the provider mock in `terminalCommands.test.ts` to assert the new provider API rather than forcing direct `openInEditorTab()` as the default focus implementation if Task 2 adds a new method.
  Must NOT do: Do not change command IDs or command count. Do not make explicit `openTerminalInEditor` obey the default location; it must always open an editor terminal.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [5, 8] | Blocked by: [1, 2]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `src/core/commands/terminalCommands.ts:20` - current send-focus helper hardcodes sidebar naming and focus command.
  - Pattern:  `src/core/commands/terminalCommands.ts:35` - `ulw.start` currently calls `deps.provider?.startOpenCode()`.
  - Pattern:  `src/core/commands/terminalCommands.ts:188` - `ulw.focus` currently executes `workbench.view.focus`.
  - Pattern:  `src/core/commands/terminalCommands.ts:198` - explicit editor command must remain direct editor open.
  - Pattern:  `src/core/commands/terminalCommands.ts:205` - restore-to-sidebar command must remain independent.
  - Test:     `src/core/commands/terminalCommands.test.ts:54` - current config mock already has `terminalDefaultLocation`; align it with final API.
  - Test:     `src/core/commands/terminalCommands.test.ts:141` - command count assertion must remain 9.
  - Test:     `src/core/commands/terminalCommands.test.ts:170` - editor default start behavior test.
  - Test:     `src/core/commands/terminalCommands.test.ts:548` - focus/editor/restore behavior tests; tighten to reveal/reuse behavior if provider API changes.

  Acceptance criteria (agent-executable only):
  - [ ] `ulw.start` in editor mode invokes the provider configured-location start API and does not call `workbench.view.focus`.
  - [ ] `ulw.start` in sidebar mode preserves sidebar runtime start behavior.
  - [ ] `ulw.focus` in editor mode invokes the provider configured-location focus API and does not execute `workbench.view.focus`.
  - [ ] `ulw.focus` in sidebar mode executes the current sidebar focus path.
  - [ ] `sendToTerminal`, `sendAtMention`, `sendAllOpenFiles`, and `sendFileToTerminal` still honor `autoFocusOnSend`; when enabled, they route through the configured focus command.
  - [ ] `npm run test -- src/core/commands/terminalCommands.test.ts` passes.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: command routing honors editor and sidebar defaults
    Tool:     bash
    Steps:    mkdir -p evidence && npm run test -- src/core/commands/terminalCommands.test.ts > evidence/task-3-command-routing.txt 2>&1
    Expected: exit code 0; evidence includes start/focus tests for both editor and sidebar
    Evidence: evidence/task-3-command-routing.txt

  Scenario: command count and explicit editor/restore commands are unchanged
    Tool:     bash
    Steps:    npm run test -- src/core/commands/terminalCommands.test.ts -t "registers all 9 terminal commands|keeps explicit editor and restore commands independent" > evidence/task-3-command-routing-error.txt 2>&1
    Expected: exit code 0; evidence shows command count is 9 and explicit commands remain independent
    Evidence: evidence/task-3-command-routing-error.txt
  ```

  Commit: YES | Message: `feat(commands): honor terminal default location` | Files: [`src/core/commands/terminalCommands.ts`, `src/core/commands/terminalCommands.test.ts`]

- [ ] 4. Extension lifecycle prompt/handoff routing

  What to do: Update `ExtensionLifecycle.sendPromptToOpenCode()` so missing-terminal startup uses the provider configured-location start API from Task 2 instead of direct `startOpenCode()`. Keep discovered-instance fallback before local startup. Keep post-send focus controlled by `autoFocusOnSend`, but ensure it routes through `ulw.focus`, then provider focus, so editor default opens/reveals editor and sidebar default focuses the sidebar. Keep `consumeSessionHandoff()` executing `ulw.focus`; Task 3 makes that location-aware. Add tests for editor default, sidebar default, disabled focus, and discovered-instance fallback.
  Must NOT do: Do not bypass `SessionWindowHandoffService`; do not move prompt delivery or API fallback logic out of lifecycle.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [5, 8] | Blocked by: [2]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `src/core/ExtensionLifecycle.ts:391` - handoff currently executes `ulw.focus`; keep it, relying on Task 3.
  - Pattern:  `src/core/ExtensionLifecycle.ts:401` - prompt delivery entrypoint.
  - Pattern:  `src/core/ExtensionLifecycle.ts:406` - missing-terminal branch currently tries discovered instances before local startup.
  - Pattern:  `src/core/ExtensionLifecycle.ts:413` - direct `this.tuiProvider.startOpenCode()` bypass to replace.
  - Pattern:  `src/core/ExtensionLifecycle.ts:436` - auto-focus after prompt send.
  - Test:     `src/core/ExtensionLifecycle.test.ts:740` - current prompt startup/focus assertion.
  - Test:     `src/core/ExtensionLifecycle.test.ts:768` - discovered instance fallback must remain first.
  - Test:     `src/core/ExtensionLifecycle.test.ts:855` - disabled auto-focus assertion.
  - Pattern:  `src/core/AGENTS.md:25` - lifecycle should orchestrate dependencies, not own terminal behavior.

  Acceptance criteria (agent-executable only):
  - [ ] Missing-terminal prompt startup calls provider configured-location start API, not direct `startOpenCode()`.
  - [ ] Discovered-instance fallback still avoids local startup.
  - [ ] `autoFocusOnSend: true` still executes `ulw.focus` and provider focus after successful prompt delivery.
  - [ ] `autoFocusOnSend: false` does not execute `ulw.focus`.
  - [ ] `npm run test -- src/core/ExtensionLifecycle.test.ts` passes.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: lifecycle routes missing-terminal prompt startup through configured location
    Tool:     bash
    Steps:    mkdir -p evidence && npm run test -- src/core/ExtensionLifecycle.test.ts > evidence/task-4-lifecycle-routing.txt 2>&1
    Expected: exit code 0; evidence includes prompt startup, discovered fallback, and auto-focus tests
    Evidence: evidence/task-4-lifecycle-routing.txt

  Scenario: disabled auto-focus remains disabled
    Tool:     bash
    Steps:    npm run test -- src/core/ExtensionLifecycle.test.ts -t "should write directly to the terminal when HTTP is unavailable" > evidence/task-4-lifecycle-routing-error.txt 2>&1
    Expected: exit code 0; evidence shows no `ulw.focus` call when config returns false
    Evidence: evidence/task-4-lifecycle-routing-error.txt
  ```

  Commit: YES | Message: `fix(lifecycle): route prompt startup by terminal location` | Files: [`src/core/ExtensionLifecycle.ts`, `src/core/ExtensionLifecycle.test.ts`]

- [ ] 5. E2E coverage for contribution and command behavior

  What to do: Add VS Code-host e2e assertions that the extension contributes the new setting, default, enum, and view `when` gate. Add command behavior e2e that sets `ulw.terminal.defaultLocation` to `editor` and `sidebar` in workspace configuration and executes `ulw.focus`/`ulw.start` without rejection. Keep these tests focused on extension surface behavior; detailed provider assertions stay in unit tests. Update `commands.e2e.ts`, `contributions.e2e.ts`, `config-comprehensive.e2e.ts`, and, if needed, `webview.e2e.ts` so they no longer imply the sidebar view is always visible by default.
  Must NOT do: Do not duplicate every provider unit case in e2e. Do not depend on generated `out/test/e2e`.

  Parallelization: Can parallel: NO | Wave 3 | Blocks: [8] | Blocked by: [1, 3, 4, 6]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `src/test/e2e/suite/contributions.e2e.ts:44` - activation/packageJSON helper.
  - Pattern:  `src/test/e2e/suite/contributions.e2e.ts:59` - secondary sidebar container assertion; adjust wording to account for opt-in view.
  - Pattern:  `src/test/e2e/suite/contributions.e2e.ts:102` - terminal view metadata assertion.
  - Pattern:  `src/test/e2e/suite/config-comprehensive.e2e.ts:195` - exact config property count; should be 30 after Task 1.
  - Pattern:  `src/test/e2e/suite/commands.e2e.ts:37` - defaults smoke test; add location default assertion.
  - Pattern:  `src/test/e2e/suite/session-flows.e2e.ts:49` - workspace settings and command execution pattern.
  - Pattern:  `src/test/e2e/AGENTS.md:36` - e2e tests use Mocha/VS Code test runner, not Vitest.

  Acceptance criteria (agent-executable only):
  - [ ] `npm run compile:e2e` passes.
  - [ ] `npm run test:e2e` passes.
  - [ ] E2E output includes coverage for `ulw.terminal.defaultLocation` default `editor`.
  - [ ] E2E output includes coverage for the sidebar view `when` gate string.
  - [ ] E2E command execution under both `editor` and `sidebar` settings does not reject.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: VS Code e2e contribution and config coverage passes
    Tool:     bash
    Steps:    mkdir -p evidence && npm run compile:e2e > evidence/task-5-e2e-compile.txt 2>&1 && npm run test:e2e > evidence/task-5-e2e.txt 2>&1
    Expected: exit code 0; evidence shows all VS Code e2e suites passed
    Evidence: evidence/task-5-e2e.txt

  Scenario: e2e detects missing sidebar view gate
    Tool:     bash
    Steps:    node -e "const fs=require('fs'); const s=fs.readFileSync('src/test/e2e/suite/contributions.e2e.ts','utf8'); if(!s.includes(\"config.ulw.terminal.defaultLocation == 'sidebar'\")) throw new Error('e2e missing view when assertion'); console.log('e2e gate assertion present')" > evidence/task-5-e2e-error.txt 2>&1
    Expected: exit code 0; evidence contains "e2e gate assertion present"
    Evidence: evidence/task-5-e2e-error.txt
  ```

  Commit: YES | Message: `test(e2e): cover terminal default location` | Files: [`src/test/e2e/suite/contributions.e2e.ts`, `src/test/e2e/suite/config-comprehensive.e2e.ts`, `src/test/e2e/suite/commands.e2e.ts`, `src/test/e2e/suite/webview.e2e.ts`]

- [ ] 6. Sidebar auto-start guard

  What to do: Update `TerminalProvider.resolveWebviewView()` so sidebar `autoStartOnOpen` only auto-starts when `terminal.defaultLocation === "sidebar"`. If the view is somehow resolved while the setting is `editor`, it may initialize HTML and flush messages, but it must not start the runtime or show native restore prompts from sidebar visibility alone. Preserve native restore prompt behavior when the setting is `sidebar`. Add unit tests for visible sidebar view with editor default, visible sidebar view with sidebar default, and hidden-to-visible transition under both values.
  Must NOT do: Do not prevent explicit restore-to-sidebar from working when the user changes setting to `sidebar`.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [5, 8] | Blocked by: [1, 2]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `src/providers/TerminalProvider.ts:195` - sidebar `resolveWebviewView()` setup.
  - Pattern:  `src/providers/TerminalProvider.ts:227` - `autoStartOnOpen` config read.
  - Pattern:  `src/providers/TerminalProvider.ts:243` - visibility listener auto-start branch.
  - Pattern:  `src/providers/TerminalProvider.ts:258` - initial visible auto-start branch.
  - Pattern:  `src/providers/TerminalProvider.ts:272` - prompt-native-restore branch when auto-start is false.
  - Pattern:  `src/providers/TerminalProvider.ts:727` - native restore record conditions.
  - Test:     `src/providers/TerminalProvider.test.ts:2322` - hidden webview visibility auto-start test.
  - Test:     `src/providers/TerminalProvider.test.ts:3034` - native restore fallback tests referenced by provider exploration.

  Acceptance criteria (agent-executable only):
  - [ ] With `terminal.defaultLocation: "editor"` and `autoStartOnOpen: true`, resolving a visible sidebar view does not call `startOpenCode()`.
  - [ ] With `terminal.defaultLocation: "sidebar"` and `autoStartOnOpen: true`, existing sidebar auto-start behavior still calls `startOpenCode()`.
  - [ ] With editor default, hidden-to-visible sidebar transition does not start the runtime.
  - [ ] With sidebar default, hidden-to-visible sidebar transition preserves current auto-start behavior.
  - [ ] `npm run test -- src/providers/TerminalProvider.test.ts` passes.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: sidebar autostart respects sidebar opt-in
    Tool:     bash
    Steps:    mkdir -p evidence && npm run test -- src/providers/TerminalProvider.test.ts -t "auto-start" > evidence/task-6-sidebar-autostart.txt 2>&1
    Expected: exit code 0; evidence includes editor-default no-start and sidebar-default start tests
    Evidence: evidence/task-6-sidebar-autostart.txt

  Scenario: native restore is not prompted from sidebar in editor-default mode
    Tool:     bash
    Steps:    npm run test -- src/providers/TerminalProvider.test.ts -t "native restore" > evidence/task-6-sidebar-autostart-error.txt 2>&1
    Expected: exit code 0; evidence shows native restore remains covered and editor-default sidebar visibility does not prompt
    Evidence: evidence/task-6-sidebar-autostart-error.txt
  ```

  Commit: YES | Message: `fix(provider): guard sidebar autostart by location` | Files: [`src/providers/TerminalProvider.ts`, `src/providers/TerminalProvider.test.ts`]

- [ ] 7. Documentation and settings discoverability

  What to do: Update `docs/en/README.md` and `docs/ko/README.md` to describe `ulw.terminal.defaultLocation`, default `editor`, and `sidebar` opt-in. Keep language concise and align with current docs sections around settings and tmux behavior. If the extension README at repo root exists later in the branch, update the same setting there too. Do not rewrite unrelated docs or change product branding.
  Must NOT do: Do not claim the secondary-sidebar container disappears until Task 8 manual QA evidence confirms it; phrase docs around the view being opt-in.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [8] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `docs/en/README.md:92` - tmux/terminal manager section.
  - Pattern:  `docs/en/README.md:155` - settings table area for AI tool and tmux behavior.
  - Pattern:  `docs/ko/README.md:92` - Korean tmux/terminal manager section.
  - Pattern:  `docs/ko/README.md:155` - Korean settings table area.
  - Pattern:  `package.json:354` - canonical contributed setting metadata.

  Acceptance criteria (agent-executable only):
  - [ ] `docs/en/README.md` mentions `ulw.terminal.defaultLocation`, `editor`, and `sidebar`.
  - [ ] `docs/ko/README.md` mentions `ulw.terminal.defaultLocation`, `editor`, and `sidebar`.
  - [ ] No generated docs or unrelated sections are changed.
  - [ ] `npm run lint` passes after docs and code tasks.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: docs mention the setting in both languages
    Tool:     bash
    Steps:    mkdir -p evidence && node -e "const fs=require('fs'); for (const f of ['docs/en/README.md','docs/ko/README.md']) { const s=fs.readFileSync(f,'utf8'); for (const token of ['ulw.terminal.defaultLocation','editor','sidebar']) if(!s.includes(token)) throw new Error(`${f} missing ${token}`); } console.log('docs setting references ok')" > evidence/task-7-docs.txt 2>&1
    Expected: exit code 0; evidence contains "docs setting references ok"
    Evidence: evidence/task-7-docs.txt

  Scenario: docs do not claim unverified container hiding
    Tool:     bash
    Steps:    node -e "const fs=require('fs'); const text=fs.readFileSync('docs/en/README.md','utf8')+'\\n'+fs.readFileSync('docs/ko/README.md','utf8'); if(/container disappears|activity bar disappears|secondary sidebar icon disappears/i.test(text)) throw new Error('docs overclaim unverified container hiding'); console.log('docs avoid unverified container claim')" > evidence/task-7-docs-error.txt 2>&1
    Expected: exit code 0; evidence contains "docs avoid unverified container claim"
    Evidence: evidence/task-7-docs-error.txt
  ```

  Commit: YES | Message: `docs(settings): document terminal default location` | Files: [`docs/en/README.md`, `docs/ko/README.md`]

- [ ] 8. Install and tmux manual QA evidence

  What to do: Run full verification, package/install through `dev-install.sh`, then drive VS Code as an installed extension. Capture evidence proving editor default and sidebar opt-in. Use a real tmux session if tmux is installed; if tmux is not installed, capture `tmux -V` failure and run the same UI checks with native backend, then mark tmux-specific evidence as environment-skipped with command output. For installed-extension UI checks, use computer-use or Chrome only if VS Code is exposed through a browser-like automation target; otherwise use OS-level GUI automation. Verify the secondary sidebar view is not visible by default with `editor`, then update the setting to `sidebar`, reload, and verify the ULW secondary sidebar view is available.
  Must NOT do: Do not declare complete without installed-extension evidence. Do not skip the visibility check for the secondary sidebar option.

  Parallelization: Can parallel: NO | Wave 3 | Blocks: [] | Blocked by: [1, 2, 3, 4, 5, 6, 7]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `package.json:634` - available compile/package/lint/test scripts.
  - Pattern:  `dev-install.sh:44` - dev install script builds with `npm run compile`.
  - Pattern:  `dev-install.sh:49` - dev install script packages with `npx @vscode/vsce package`.
  - Pattern:  `dev-install.sh:61` - dev install script installs the generated VSIX with `code --install-extension`.
  - Pattern:  `src/test/e2e/AGENTS.md:40` - `npm run test:e2e` runs pretest build and e2e compile.
  - Pattern:  `src/services/TmuxSessionManager.ts:122` - tmux availability check uses `tmux -V`.
  - External: `https://code.visualstudio.com/api/references/when-clause-contexts` - setting-backed visibility gate must be confirmed in installed VS Code.

  Acceptance criteria (agent-executable only):
  - [ ] `npm run compile` exits 0.
  - [ ] `npm run lint` exits 0.
  - [ ] `npm run test` exits 0.
  - [ ] `npm run test:coverage` exits 0.
  - [ ] `npm run compile:e2e` exits 0.
  - [ ] `npm run test:e2e` exits 0.
  - [ ] `./dev-install.sh` exits 0 and installs the VSIX.
  - [ ] With `ulw.terminal.defaultLocation` unset/default, `ulw.start` opens/reveals an editor terminal panel and starts the selected backend.
  - [ ] With default editor, the ULW terminal view is not available as a secondary-sidebar option; if the container still appears, record exact evidence and block completion for product decision.
  - [ ] With setting changed to `sidebar` and VS Code reloaded, the ULW terminal view appears in the secondary sidebar and `ulw.start` preserves sidebar behavior.
  - [ ] Tmux backend path is exercised when `tmux -V` succeeds: start a tmux-backed ULW terminal, verify an attached tmux session exists via `tmux list-sessions`, then capture UI evidence.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: full automated verification and install pass
    Tool:     bash
    Steps:    mkdir -p evidence && npm run compile > evidence/task-8-compile.txt 2>&1 && npm run lint > evidence/task-8-lint.txt 2>&1 && npm run test > evidence/task-8-unit.txt 2>&1 && npm run test:coverage > evidence/task-8-coverage.txt 2>&1 && npm run compile:e2e > evidence/task-8-compile-e2e.txt 2>&1 && npm run test:e2e > evidence/task-8-e2e.txt 2>&1 && ./dev-install.sh > evidence/task-8-dev-install.txt 2>&1
    Expected: exit code 0; every evidence file shows successful completion
    Evidence: evidence/task-8-dev-install.txt

  Scenario: installed VS Code verifies editor default, sidebar opt-in, and tmux behavior
    Tool:     computer-use
    Steps:    Open VS Code for this workspace; run "Developer: Reload Window"; ensure `ulw.terminal.defaultLocation` is unset or `editor`; run command palette command "ULW: Start ULW Terminal"; capture screenshot `evidence/task-8-manual-tmux-editor.png`; run "Preferences: Open Workspace Settings (JSON)" and set `"ulw.terminal.defaultLocation": "sidebar"`; reload; verify the ULW terminal view appears in the secondary sidebar; run "ULW: Focus Terminal"; capture screenshot `evidence/task-8-manual-tmux-sidebar.png`; if `tmux -V` succeeds, run `tmux list-sessions` and capture output to `evidence/task-8-manual-tmux.txt`.
    Expected: editor screenshot shows ULW Terminal as an editor webview panel; sidebar screenshot shows ULW Terminal in the secondary sidebar only after setting `sidebar`; tmux evidence contains at least one session when tmux is installed
    Evidence: evidence/task-8-manual-tmux.txt
  ```

  Commit: NO | Message: `n/a` | Files: [`evidence/task-8-compile.txt`, `evidence/task-8-lint.txt`, `evidence/task-8-unit.txt`, `evidence/task-8-coverage.txt`, `evidence/task-8-compile-e2e.txt`, `evidence/task-8-e2e.txt`, `evidence/task-8-dev-install.txt`, `evidence/task-8-manual-tmux-editor.png`, `evidence/task-8-manual-tmux-sidebar.png`, `evidence/task-8-manual-tmux.txt`]

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
- Reference the plan file path in the final commit footer: `Plan: plans/terminal-default-location.md`.

## Success criteria
- All Must-Have shipped; all QA scenarios pass with captured evidence; F1-F4 approved; commit history clean.
