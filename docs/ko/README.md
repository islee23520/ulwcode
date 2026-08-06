# ULW 사이드바 터미널

ULW는 VS Code 보조 사이드바에서 네이티브 셸 터미널 하나만 실행합니다.

## 사용법

보조 사이드바를 열고 **ULW**를 선택하세요. 워크스페이스가 있으면 첫 번째 워크스페이스 폴더에서, 없으면 사용자 홈 디렉터리에서 셸이 시작됩니다.

`ulw.defaultLocation`을 `editor`(기본값) 또는 `sidebar`로 설정하면 시작 위치를 고를 수 있습니다. **ULW: Toggle Terminal Location** 명령으로 같은 셸을 두 표면 사이에서 옮길 수 있습니다.

## 설정

다음 설정으로 글꼴, 커서, 스크롤백, 셸 실행 파일과 인자를 지정할 수 있습니다.

- `ulw.fontSize`
- `ulw.fontFamily`
- `ulw.cursorBlink`
- `ulw.cursorStyle`
- `ulw.scrollback`
- `ulw.shellPath`
- `ulw.shellArgs`

기본값과 개발 명령은 [메인 README](../../README.md)를 참고하세요.
