# ULW 작업 플랜: 트리아지 이슈/PR 정리

## 목표

트리아지된 GitHub 항목을 안전한 실행 순서로 정리하고, 각 작업을 TDD + 실제 표면 QA로 검증할 수 있게 만든다.

## 현재 상태 요약

- #45 `CLA bot is broken`: 완료됨. `cla-signatures` 브랜치가 생성됐고 PR #44의 `Check CLA`가 통과한다. 향후 작업 전제조건으로만 확인한다.
- PR #44 `fix(webview): improve scroll and keyboard behavior in terminal`: 열려 있음. CLA 통과, mergeable. 이전 리뷰에서 Windows wheel fallback 회귀를 지적했고, contributor가 `47816a6`에서 global mouse tracking 제거와 wheel regression test를 추가했다. 재리뷰가 필요하다.
- #38 `Ctrl + C does not pass through`: 열려 있음. Ctrl+C 자체는 1.8.0에서 해결된 것으로 보이나, Ctrl+V/right-click paste/scroll 회귀 보고가 남아 있다.
- #36 `Intercept keyboard shortcuts`: 열려 있음. `sendKeybindingsToShell` 및 keybinding override가 현재 workaround지만, TUI 키 조합 전달의 기본 경험 개선이 필요하다.
- #42 `Ctrl+click file open`: 열려 있음. 터미널 출력의 파일 링크를 Ctrl/Cmd-click으로 VS Code에서 열어야 하며, line/column suffix를 지원해야 한다.

## 추천 결정

1. **PR #44 재리뷰를 먼저 한다.**
   - 이유: #38의 scroll 회귀와 직접 연결된 외부 PR이며, 이미 contributor가 blocker를 수정했다. 이 PR을 먼저 정리하면 이후 #38/#36 작업의 기준선이 안정된다.
   - 처리: 현재 GitHub review state가 `CHANGES_REQUESTED`로 남아 있으므로, 최신 commit을 검증한 뒤 문제가 없으면 새 `APPROVE` review로 상태를 갱신한다. 기존 review를 임의 dismiss하지 않는다.
2. **#38과 #36은 한 작업 묶음으로 다룬다.**
   - 이유: 둘 다 `src/webview/terminal/keyboard.ts`, paste bridge, keybinding contribution의 같은 표면을 건드린다. 따로 처리하면 Ctrl+C/Ctrl+V/Ctrl+P 회귀를 반복해서 만들 가능성이 높다.
   - 처리: #38은 처음에는 tracker로 유지한다. 검증 후 Ctrl+V, right-click paste, scroll 중 독립 재현되는 문제가 있으면 별도 이슈로 분리하거나 PR 설명에 하위 항목으로 명시한다.
3. **#42는 keyboard/paste 안정화 뒤에 한다.**
   - 이유: 링크 활성화는 `src/webview/links/index.ts`와 `src/providers/MessageRouter.ts` 중심이라 별도 작업이지만, Ctrl/Cmd modifier 해석은 keyboard 정책과 충돌할 수 있다.
   - 처리: 사용자 요청은 Ctrl/Cmd-click이므로 수동 QA는 반드시 modifier click으로 검증한다. xterm link API가 plain activation을 같이 허용하더라도, host open 계약과 테스트는 modifier 요청의 실제 결과를 기준으로 한다.

## 기본 정책 결정

- macOS: Cmd 계열 IDE shortcut은 VS Code 소유로 유지한다. TUI shortcut은 Ctrl 계열로 전달한다.
- Windows/Linux: `sendKeybindingsToShell=true`일 때 Ctrl+letter/digit TUI chord를 shell로 전달하되, Ctrl+V paste는 host paste 경로를 우선한다.
- Windows/Linux: `sendKeybindingsToShell=false`일 때 Ctrl+P 같은 workbench chord는 터미널로 보내지 않고 VS Code/IDE가 처리하게 둔다. 단 Ctrl+C 같은 shell control key는 설정값과 무관하게 terminal에 남긴다.
- File open: workspace-relative path와 안전한 absolute file path만 연다. non-string, malformed URI, line/column이 유효한 양의 정수가 아닌 payload는 무시한다.
- Right-click paste: 현재 코드가 `contextmenu`를 prevent하는 구조라서 Ctrl+V 수정과 별도이다. 실제 재현 후 구현 또는 follow-up 분리한다.

## 범위

IN:
- PR #44 재검토, 필요 시 approve/merge 결정.
- #38/#36 키보드·paste·scroll 동작 검증 및 수정 계획.
- #42 파일 링크 열기 UX 구현 계획.
- 각 작업의 RED→GREEN 테스트, 수동 QA, GitHub 댓글/상태 업데이트.

OUT:
- #45 추가 구현. 이미 완료된 인프라 작업이므로 regression 확인만 한다.
- 현재 dirty local branch의 무단 정리, revert, commit.
- 릴리스 배포 자동화.

## 공통 작업 전 준비

1. 작업 시작 전 `git status --short --branch`를 저장한다.
2. 현재 dirty worktree와 섞지 않도록 각 구현은 별도 worktree에서 시작한다.
   - PR #44 검토: `/private/tmp/open-sidebar-pr44-review`
   - #38/#36 구현: `/private/tmp/open-sidebar-input-fixes`
   - #42 구현: `/private/tmp/open-sidebar-file-links`
3. 각 worktree에서 `npm ci`를 먼저 수행한다.
4. 구현 전 기준선:
   - `npm run compile`
   - 관련 단위 테스트
   - 필요한 경우 `npm run compile:e2e`
5. 모든 GitHub write action 전 대상 번호를 재확인한다.

## Wave 1: PR #44 재리뷰

### 목적

이전 requested changes가 실제로 해결됐는지 확인하고, 문제가 없으면 review 상태를 갱신한다.

### 대상

- GitHub PR #44
- `src/webview/terminal/index.ts`
- `src/webview/terminal/index.test.ts`
- `src/webview/terminal/keyboard.ts`
- `src/webview/terminal/keyboard.test.ts`

### RED 테스트

새 production code를 작성하지 않는 리뷰 작업이므로 새 RED 테스트는 필수 산출물이 아니다. 단, 리뷰 중 결함을 발견하면 해당 결함을 재현하는 failing test를 PR branch에 제안하거나 로컬 patch로 작성한 뒤 comment한다.

### 검증 명령

깨끗한 PR worktree에서 실행:

```bash
git fetch origin pull/44/head:refs/remotes/pull/44/head
git worktree add /private/tmp/open-sidebar-pr44-review refs/remotes/pull/44/head
cd /private/tmp/open-sidebar-pr44-review
npm ci
npm run test -- src/webview/terminal/index.test.ts src/webview/terminal/keyboard.test.ts
npm run compile
npm run lint -- src/webview/terminal/index.ts src/webview/terminal/index.test.ts src/webview/terminal/keyboard.ts src/webview/terminal/keyboard.test.ts
gh pr checks 44 --repo islee23520/ulwcode
```

### 수동 QA

Manual QA channel: Computer Use.

Scenario:
- VS Code Extension Development Host에서 PR #44 build를 실행한다.
- Windows 환경이 실제로 없으면 최소한 browser/jsdom 단위 테스트 결과를 evidence로 남기고, Windows real-surface QA는 release 전 residual risk로 표기한다.
- 실제 Windows 또는 Windows VM이 가능하면 sidebar terminal에서 일반 shell 상태와 mouse-aware TUI 상태를 각각 열고 wheel 동작을 확인한다.

PASS 기준:
- 일반 shell에서는 Windows wheel fallback이 scrollback을 움직인다.
- mouse tracking TUI에서는 wheel event가 TUI로 전달된다.
- Ctrl+V/paste와 Shift+Enter가 기존 기대 동작을 깨지 않는다.

### GitHub 처리

- blocker 해결 확인 시 PR #44에 approve review 작성.
- 새 결함 발견 시 request changes 유지하고 구체적 파일/라인 comment 작성.
- PR을 merge할지는 approve 이후 별도 maintainer 결정으로 둔다. 이 플랜의 기본 완료 기준은 "최신 commit 검증 + review state 갱신"이다.

## Wave 2: #38/#36 입력·키보드 안정화

### 목적

Ctrl+C, Ctrl+V, right-click paste, Ctrl+P/TUI shortcuts, IDE shortcut 보존 정책을 하나의 계약으로 고정한다.

### 대상 파일

- `src/webview/terminal/keyboard.ts`
- `src/webview/terminal/keyboard.test.ts`
- `src/webview/clipboard/index.ts`
- `src/webview/clipboard/index.test.ts`
- `src/providers/MessageRouter.ts`
- `src/providers/MessageRouter.test.ts`
- `src/providers/TerminalProvider.ts`
- `src/providers/TerminalProvider.test.ts`
- `package.json`
- `src/test/e2e/suite/contributions.e2e.ts`

### RED 테스트

추가할 테스트 이름:

- `src/webview/terminal/keyboard.test.ts`
  - `requests host paste for Ctrl+V even when sendKeybindingsToShell is enabled`
  - `forwards Ctrl+C to xterm without invoking host paste`
  - `keeps Ctrl+P with xterm when sendKeybindingsToShell is enabled`
  - `lets VS Code handle Ctrl+P when sendKeybindingsToShell is disabled`
- `src/providers/MessageRouter.test.ts`
  - `pastes clipboard text through triggerPaste without writing empty payload`
  - `surfaces clipboard read failures without corrupting terminal input`
- `src/test/e2e/suite/contributions.e2e.ts`
  - `contributes paste command and keybinding for focused sidebar terminal`

RED 증거:
- 각 테스트를 production change 전에 실행하고, 기대 assertion failure를 기록한다.

### 구현 기준

- Ctrl+C는 terminal byte `\x03`이 PTY로 간다.
- Ctrl+V/Cmd+V는 host clipboard paste path를 탄다.
- Ctrl+P 같은 TUI chord는 `sendKeybindingsToShell=true`일 때 shell로 간다.
- Ctrl+P 같은 workbench chord는 `sendKeybindingsToShell=false`일 때 terminal로 보내지 않고 VS Code가 처리하게 둔다.
- macOS Cmd 기반 IDE shortcuts는 기존 VS Code 행동을 불필요하게 뺏지 않는다.
- right-click paste가 지원되지 않는다면 #38 댓글에서 별도 follow-up으로 분리한다. 구현할 경우 `contextmenu` 처리와 host paste command의 충돌을 테스트로 먼저 고정한다.
- scroll 회귀가 PR #44 merge 후에도 남으면 #38 하위 버그로 유지한다. PR #44로 해결되면 #38 댓글에서 scroll 항목은 확인 완료로 표시한다.

### 검증 명령

```bash
npm run test -- src/webview/terminal/keyboard.test.ts src/webview/clipboard/index.test.ts src/providers/MessageRouter.test.ts src/providers/TerminalProvider.test.ts
npm run compile
npm run lint -- src/webview/terminal/keyboard.ts src/webview/terminal/keyboard.test.ts src/webview/clipboard/index.ts src/webview/clipboard/index.test.ts src/providers/MessageRouter.ts src/providers/MessageRouter.test.ts src/providers/TerminalProvider.ts src/providers/TerminalProvider.test.ts
npm run compile:e2e
```

### 수동 QA

Manual QA channel: Computer Use.

Scenario A:
- Extension Development Host를 열고 sidebar terminal에 `cat` 또는 shell prompt를 실행한다.
- clipboard에 `hello-from-clipboard`를 넣는다.
- sidebar focused 상태에서 Ctrl+V/Cmd+V를 누른다.
- PASS: terminal에 `hello-from-clipboard`가 입력된다.

Scenario B:
- sidebar terminal에서 장시간 실행 명령을 실행한다.
- Ctrl+C를 누른다.
- PASS: 프로세스가 interrupt되고 `^C` 또는 prompt 복귀가 보인다.

Scenario C:
- opencode 또는 TUI 대체 프로그램에서 Ctrl+P를 누른다.
- PASS: VS Code quick open이 뜨지 않고 TUI가 키를 받는다.

Scenario D:
- `ulw.sendKeybindingsToShell=false`로 설정한 뒤 sidebar terminal focus 상태에서 Ctrl+P를 누른다.
- PASS: terminal input으로 전달되지 않고 VS Code quick open 또는 IDE 기본 동작이 실행된다.

### GitHub 처리

- #38에는 실제 확인한 Ctrl+C/Ctrl+V/right-click/scroll 결과를 댓글로 남긴다.
- #36에는 shortcut 정책과 설정 동작을 댓글로 남긴다.

## Wave 3: #42 파일 링크 Ctrl/Cmd-click 열기

### 목적

opencode terminal output의 파일 경로를 클릭 가능한 링크로 만들고, VS Code editor에서 line/column 위치로 연다.

### 대상 파일

- `src/webview/links/index.ts`
- `src/webview/links/index.test.ts`
- `src/types.ts`
- `src/types.test.ts`
- `src/providers/MessageRouter.ts`
- `src/providers/MessageRouter.test.ts`

### RED 테스트

추가할 테스트 이름:

- `src/webview/links/index.test.ts`
  - `links at-prefixed opencode paths with line and column suffix`
  - `links absolute file URLs and decodes encoded spaces`
  - `does not link malformed paths or oversized terminal lines`
- `src/providers/MessageRouter.test.ts`
  - `opens workspace file at requested line and column from openFile message`
  - `rejects non-string openFile paths without host side effects`
- `src/types.test.ts`
  - `accepts openFile message with path line column and endLine`

RED 증거:
- 새 link formats를 production change 전에 실패시킨다.
- host open behavior가 line/column을 반영하지 않는 경우 실패를 확인한다.

### 구현 기준

- link provider는 shell/opencode 전용 parser가 아니라 일반 path parser로 유지한다.
- 지원 포맷:
  - `src/foo.ts`
  - `src/foo.ts:12`
  - `src/foo.ts:12:3`
  - `@src/foo.ts:12:3`
  - `file:///.../src/foo.ts:12`
  - `README.md#L10`
- activation payload는 `WebviewMessage`의 `openFile` 계약을 사용한다.
- host는 workspace-relative path와 absolute path를 모두 안전하게 처리한다.
- host는 URI scheme이 `file:`이 아닌 URL, traversal-only payload, line/column `0`, `NaN`, negative 값을 열지 않는다.

### 검증 명령

```bash
npm run test -- src/webview/links/index.test.ts src/providers/MessageRouter.test.ts src/types.test.ts
npm run compile
npm run lint -- src/webview/links/index.ts src/webview/links/index.test.ts src/providers/MessageRouter.ts src/providers/MessageRouter.test.ts src/types.ts src/types.test.ts
```

### 수동 QA

Manual QA channel: Computer Use.

Scenario:
- Extension Development Host에서 sidebar terminal을 연다.
- 터미널에 `printf 'src/providers/MessageRouter.ts:120:5\n'`를 출력한다.
- 해당 링크를 Ctrl/Cmd-click한다.
- PASS: VS Code editor가 `src/providers/MessageRouter.ts`를 열고 line 120, column 5 근처를 reveal한다.

## Wave 4: 통합 검증 및 GitHub 정리

### 전체 검증

```bash
npm run test
npm run compile
npm run compile:e2e
```

가능하면:

```bash
npm run test:e2e
```

### Manual QA 회귀 묶음

Manual QA channel: Computer Use.

PASS 기준:
- sidebar terminal 시작.
- Ctrl+C interrupt.
- Ctrl+V/Cmd+V paste.
- Ctrl+P TUI chord 전달.
- Shift+Enter multiline.
- scrollback wheel.
- file link open.

### GitHub 업데이트

- #38: 확인/수정 결과 댓글. 해결 범위가 Ctrl+C가 아니라 paste/scroll이면 제목 또는 follow-up 이슈 제안.
- #36: shortcut 정책/설정 결과 댓글.
- #42: file link 지원 포맷과 사용법 댓글.
- PR #44: approve/merge 또는 추가 request changes.

## 위험과 대응

- Dirty worktree: 별도 worktree 사용, 기존 변경 절대 revert 금지.
- PR #44 외부 브랜치: maintainer 권한으로 직접 수정하지 말고 리뷰/merge 중심으로 처리.
- Windows-only wheel behavior: 실제 Windows QA가 없으면 merge 전 명시적 residual risk로 남긴다.
- Keyboard regression: Ctrl+C/Ctrl+V/Ctrl+P/Shift+Enter를 한 테스트 묶음으로 고정한다.
- Webview/VS Code real-surface QA: CLI 테스트만으로 완료 처리하지 않는다. Extension Development Host에서 Computer Use QA를 수행한다.
- #42 file open 보안: host-side path normalization과 invalid payload no-op 테스트를 필수로 둔다.

## 최종 권장 순서

1. PR #44 재리뷰 및 review 상태 정리.
2. #38/#36 입력·키보드 통합 수정.
3. #42 파일 링크 열기 구현.
4. 전체 회귀 QA와 GitHub 댓글/닫기.

## 결정 필요 항목

추천 기본값은 아래와 같다.

- PR #44 먼저 처리: 예.
- #38/#36 묶어서 처리: 예.
- #42는 뒤로 미루기: 예.
- Windows 실제 QA가 없을 때: merge 전 residual risk로 표기하고 가능하면 Windows 사용자에게 확인 요청.
