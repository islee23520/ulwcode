# ULW サイドバーターミナル

ULW は VS Code のセカンダリサイドバーでネイティブシェルターミナルを 1 つだけ実行します。

## 使い方

セカンダリサイドバーを開き、**ULW** を選択します。ワークスペースがある場合は最初のワークスペースフォルダー、ない場合はホームディレクトリでシェルが起動します。

`ulw.defaultLocation` を `editor`（既定）または `sidebar` に設定すると初期表示先を選べます。**ULW: Toggle Terminal Location** で同じシェルを両面の間で移動できます。

## 設定

フォント、カーソル、スクロールバック、シェル実行ファイル、引数は次の設定で変更できます。

- `ulw.fontSize`
- `ulw.fontFamily`
- `ulw.cursorBlink`
- `ulw.cursorStyle`
- `ulw.scrollback`
- `ulw.shellPath`
- `ulw.shellArgs`

既定値と開発コマンドは [README](../../README.md) を参照してください。
