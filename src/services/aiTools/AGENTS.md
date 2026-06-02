# AI TOOLS KNOWLEDGE BASE

## OVERVIEW

Operator layer for AI tool-specific launch commands, feature support, file-reference formatting, dropped files, and pasted image paths.

## STRUCTURE

```
aiTools/
├── AiToolOperator.ts                  # operator interface
├── AiToolOperatorRegistry.ts          # default operator list + config resolution
├── AiToolOperatorRegistry.test.ts
└── operators/
    ├── OpenCodeToolOperator.ts        # HTTP API + auto-context supported
    ├── ClaudeCodeToolOperator.ts      # @file formatting, no HTTP API
    ├── CodexToolOperator.ts           # @file formatting, no HTTP API
    └── *.test.ts
```

## WHERE TO LOOK

| Task                    | Location                              | Notes                                                              |
| ----------------------- | ------------------------------------- | ------------------------------------------------------------------ |
| Add operator capability | `AiToolOperator.ts`                   | interface contract; update all operators/tests                     |
| Resolve selected tool   | `AiToolOperatorRegistry.ts`           | default order: OpenCode, Claude Code, Codex                        |
| Default tool config     | `../../types.ts`                      | `DEFAULT_AI_TOOLS`, `resolveAiToolConfigs`, launch command helpers |
| OpenCode behavior       | `operators/OpenCodeToolOperator.ts`   | supports HTTP API and auto-context                                 |
| Claude behavior         | `operators/ClaudeCodeToolOperator.ts` | alias `claude`, no HTTP API                                        |
| Codex behavior          | `operators/CodexToolOperator.ts`      | id/operator `codex`, no HTTP API                                   |

## CONVENTIONS

- Match tools by `name`, `operator`, and documented aliases.
- Use `getToolLaunchCommand()` from `src/types.ts`; do not rebuild command strings locally.
- File references use `@path`, `@path#Lx`, or `@path#Lx-Ly`.
- Pasted image formatting currently returns the temp path for all built-in operators.

## ANTI-PATTERNS

- No hardcoded default tools in providers or runtime; update `DEFAULT_AI_TOOLS`.
- No operator-specific formatting in `SessionRuntime` or webview modules.
- No fallback to `as any` for unknown user tool config; parsing belongs in `resolveAiToolConfigs`.

## TESTING

- Add/update the operator's colocated test and `AiToolOperatorRegistry.test.ts`.
- If a capability changes provider/runtime behavior, add the matching `SessionRuntime` or `TerminalProvider` test too.
