# ULW 가이드

[English](../en/README.md) · [한국어](../ko/README.md) · [日本語](../ja/README.md)

- [문서 인덱스](../README.md)
- [루트 README](../../README.md)

이 문서는 **ULW**를 VS Code 안에서 Open TUI terminal MUX로 설치하고 사용하는 방법을 설명합니다.

## 개요

ULW는 OpenCode, Claude, Codex, 사용자 정의 AI 도구 또는 native shell을 VS Code의 기본 터미널 패널이 아니라 **사이드바 내부**에 직접 임베드합니다.

기본적으로 두 개의 주요 뷰를 제공합니다.

1. **ULW Terminal**: 보조 사이드바에서 실행되는 메인 TUI 세션
2. **ULW Terminal Manager**: `tmux` 세션, pane, window 관리 화면

## 주요 기능

- 터미널 뷰가 활성화되면 **OpenCode** 자동 실행
- `xterm.js`와 WebGL 기반의 전체 TUI 렌더링
- OpenCode, Claude, Codex, 사용자 정의 도구를 포함한 멀티 AI 툴 지원
- `tmux` 세션 자동 탐색 및 워크스페이스 기준 필터링
- 같은 터미널 안에서 native shell 전환 지원
- OpenCode와의 프롬프트/컨텍스트 공유를 위한 HTTP API 통신
- `@filename#L10-L20` 형식의 파일 참조 지원
- 컨텍스트 메뉴, 드래그 앤 드롭, 단축키 지원

## 설치

### VS Code Marketplace에서 설치

1. VS Code를 엽니다.
2. `Cmd+Shift+X` 또는 `Ctrl+Shift+X`로 Extensions를 엽니다.
3. **ULW**를 검색합니다.
4. **Install**을 클릭합니다.

### OpenVSX에서 설치

VSCodium, Gitpod, Eclipse Theia 등 호환 IDE에서는 다음 순서로 설치할 수 있습니다.

1. 확장 기능 화면을 엽니다.
2. **ULW**를 검색합니다.
3. **Install**을 클릭합니다.

또는 [OpenVSX 페이지](https://open-vsx.org/extension/islee23520/ulwcode)를 사용할 수 있습니다.

### 소스에서 설치

```bash
git clone https://github.com/islee23520/ulwcode.git
cd ulwcode
npm install
npm run compile
npx @vscode/vsce package
```

그 다음 Extensions 화면에서 **Install from VSIX**로 생성된 VSIX를 설치하면 됩니다.

## 빠른 시작

1. `tmux` 세션을 관리해야 할 때 **ULW Terminal Manager**를 엽니다.
2. 보조 사이드바에서 **ULW Terminal**을 엽니다.
3. 자동 시작을 사용하거나 직접 OpenCode를 시작합니다.
4. 사이드바 안에서 바로 OpenCode와 상호작용합니다.

### 자주 쓰는 단축키

| 단축키                     | 동작                          |
| -------------------------- | ----------------------------- |
| `Cmd+Alt+L` / `Ctrl+Alt+L` | 현재 파일 참조 전송           |
| `Cmd+Alt+A` / `Ctrl+Alt+A` | 열려 있는 모든 파일 참조 전송 |
| `Cmd+Alt+T` / `Ctrl+Alt+T` | `tmux` 세션 탐색              |
| `Cmd+V` / `Ctrl+V`         | 터미널에 붙여넣기             |

## 파일과 컨텍스트 공유

ULW는 여러 방식으로 OpenCode에 컨텍스트를 전달할 수 있습니다.

- **파일 참조 명령**: `@filename`, `@filename#L10`, `@filename#L10-L20`
- **컨텍스트 메뉴 연동**: 파일, 폴더, 에디터 선택 영역 전송
- **드래그 앤 드롭**: **Shift**를 누른 채 파일/폴더를 터미널에 드롭
- **자동 컨텍스트 공유**: 터미널이 열릴 때 열린 파일과 현재 선택 영역 자동 전송

파일 참조 문법은 모든 언어 문서에서 동일합니다.

- `@filename`
- `@filename#L10`
- `@filename#L10-L20`

## ULW Terminal Manager와 tmux

**ULW Terminal Manager**는 `tmux` 워크플로를 제어하는 중심 화면입니다.

다음 기능을 제공합니다.

- 기존 세션 자동 탐색
- 워크스페이스 범위 기준 필터링
- pane 분할, 포커스 이동, 크기 조절, 교체, 종료
- window 이동, 생성, 선택, 종료
- 현재 워크스페이스 세션으로 빠르게 돌아가는 배너
- 세로 공간 확보를 위한 사이드바 내부 `tmux` 상태 바 숨김

### 자주 쓰는 tmux 작업

- **Spawn Tmux Session for Workspace**
- **Select OpenCode Tmux Session**
- **Switch Tmux Session**
- **Split Pane Horizontal / Vertical**
- **Create Window**
- **Kill Pane / Kill Window / Kill Session**

## HTTP API 연동

ULW는 OpenCode와 더 안정적으로 통신하기 위해 HTTP API를 사용합니다.

### 역할

- OpenCode HTTP 서버 자동 탐색
- 요청 전 `/health` 확인
- `/tui/append-prompt`로 프롬프트와 파일 참조 전송
- 재시도 로직과 타임아웃 처리

### 동작 방식

1. OpenCode가 ephemeral port에서 HTTP 서버를 시작합니다.
2. 확장이 해당 포트를 탐색합니다.
3. 확장이 프롬프트와 컨텍스트를 HTTP로 전달합니다.
4. 사이드바 WebView가 터미널 입출력을 렌더링합니다.

## 주요 설정

실제 VS Code 설정 키와 정확히 일치해야 하므로 주요 설정 이름은 영어 그대로 유지합니다.

### 터미널 및 시작 동작

| 설정                          | 설명                                 |
| ----------------------------- | ------------------------------------ |
| `ulw.autoStart`       | 뷰가 활성화되면 OpenCode 자동 시작   |
| `ulw.autoStartOnOpen` | 사이드바가 열리면 OpenCode 자동 시작 |
| `ulw.fontSize`        | 터미널 글꼴 크기                     |
| `ulw.fontFamily`      | 터미널 글꼴 패밀리                   |
| `ulw.terminal.defaultLocation` | 기본 터미널 위치: `editor` 또는 `sidebar` |
| `ulw.autoFocusOnSend` | 파일 참조 전송 후 ULW 포커스         |

### HTTP API 및 컨텍스트 공유

| 설정                            | 설명                            |
| ------------------------------- | ------------------------------- |
| `ulw.enableHttpApi`     | HTTP API 통신 사용              |
| `ulw.httpTimeout`       | 요청 타임아웃(ms)               |
| `ulw.autoShareContext`  | 에디터 컨텍스트 자동 공유       |
| `ulw.contextDebounceMs` | 컨텍스트 업데이트 debounce 지연 |

### AI 툴 및 tmux 동작

| 설정                             | 설명                        |
| -------------------------------- | --------------------------- |
| `ulw.aiTools`            | 사용 가능한 AI 툴 구성      |
| `ulw.defaultAiTool`      | 새 `tmux` 세션의 기본 툴    |
| `ulw.enableAutoSpawn`    | OpenCode가 없으면 자동 실행 |
| `ulw.nativeShellDefault` | native shell 전환 기본 동작 |
| `ulw.tmuxSessionDefault` | 새 `tmux` 세션 기본 동작    |

## 요구 사항

- VS Code `1.106.0` 이상
- Node.js `20.0.0` 이상
- `opencode` 명령으로 실행 가능한 OpenCode 설치

## 추가 정보

전체 명령 목록, 모든 설정 표, 개발 워크플로, 구현 세부 사항은 [루트 README](../../README.md)에서 확인할 수 있습니다.
