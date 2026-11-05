# 導入・更新・解除・復旧の手順

Vencord Extended（Vencord の非公式 fork。VoiceCord 入り）を、Windows の Discord デスクトップ版に入れる・外す・直すための手順です。

## 置き場所

| もの | 場所 |
| --- | --- |
| Discord に読ませる 4 ファイル（patcher.js など） | `%LOCALAPPDATA%\VencordExtended\dist` |
| VoiceCord のランタイム（エンジン・frida） | `%LOCALAPPDATA%\VencordExtended\dist\voicecord` |
| 設定（Vencord と VoiceCord） | `%APPDATA%\Vencord`（VoiceCord は `voicecord\config.json`） |
| Discord 本体の差し替え | `%LOCALAPPDATA%\Discord<ブランチ>\app-<版>\resources\app.asar`（元の本体は同じ場所の `_app.asar`） |

公式 Vencord の `%APPDATA%\Vencord\dist` とは分けてあります。公式のインストーラで修復しても、Vencord Extended のファイルは上書きされません。

## 導入

1. [リリース](https://github.com/uta-a/vencord-extended/releases/latest)から `VencordExtendedInstaller.exe` をダウンロードします。署名が無いため、Windows の SmartScreen が警告を出すことがあります（「詳細情報」→「実行」）。
2. ダブルクリックで起動し、「Vencord Extended を導入する」→ 対象の Discord を選びます。
   - Discord が起動していれば、終了してよいか尋ねます。終わったら起動し直します。
   - 公式 Vencord や旧 VoiceCord などが入っていれば、外すものを表示してから置き換えます（二重には載せません）。
3. Discord が起動したら、初回だけ VoiceCord のランタイム（約 35 MB）を自動で取得します。取得と検証が終わるまで、VoiceCord の状態は「起動中」です。

コマンドで行う場合: `VencordExtendedInstaller.exe --install --branch canary --force-close`（`--help` で一覧）。

## 更新

- **Vencord Extended 本体**: Vencord の設定 →「更新」から、ほかの Vencord と同じく更新します。取得先は uta-a/vencord-extended のリリースです。
- **VoiceCord のランタイム**: 本体の更新で必要な版が変わったときだけ、Discord の起動時に裏で取得し、**その次の起動**で入れ替えます（動いているエンジンがファイルを掴んでいるため）。取得したものは、本体に埋め込まれた sha256 で検証してから使います。一致しなければ使わず、今の版で動き続けます。
- **Discord 本体の更新**: Discord が新しい版（`app-<版>`）に更新されると、差し替えが外れることがあります。そのときはインストーラで「導入」をもう一度行ってください。

## 解除

インストーラで「解除する」→ 対象の Discord を選びます。`_app.asar`（元の本体）を `app.asar` に戻し、素の Discord にします。

- 解除できるのは Vencord Extended の差し替えだけです。ほかの mod の差し替えには触れずに中断します。
- 設定（`%APPDATA%\Vencord`）とファイル（`%LOCALAPPDATA%\VencordExtended`）は残ります。不要なら手で消してください。

## 修復

VoiceCord が「失敗」のまま動かない、ランタイムの取得に失敗し続ける、ファイルが壊れた、というときは、インストーラで「修復する」を選びます。

- 最新のリリースの 4 ファイルを取り直します。
- VoiceCord のランタイム（`dist\voicecord`、および用意中の `voicecord.next` / `voicecord.tmp` / `voicecord.old`）を消し、次の起動で取り直させます。
- 設定には触れません。

## 困ったとき

### Discord が起動しない・真っ白になる

1. インストーラで「解除する」を選びます。
2. インストーラが使えないときは、手で戻します。
   1. Discord を終了します（タスクトレイのアイコンも。タスクマネージャーで `Discord*.exe` が無いことを確かめます）。
   2. `%LOCALAPPDATA%\Discord<ブランチ>\app-<一番新しい版>\resources` を開きます。
   3. `_app.asar` があれば、`app.asar` を削除してから、`_app.asar` の名前を `app.asar` に変えます。
   4. `_app.asar` が無いときは、Discord を再インストールしてください（設定はアカウント側に残ります）。

### VoiceCord が「失敗」と表示される

VoiceCord の設定画面の「接続状態」に理由が出ます。

- **ランタイムを取得できませんでした**: ネットワークを確かめ、Discord を再起動します。続くときは「修復」を行います。
- **ランタイムの検証に失敗しました（sha256 が一致しません）**: 取得したファイルが壊れているか、配布物が差し替えられています。使わずに止めています。「修復」を行い、それでも続くときは Issue で知らせてください。
- **エンジンが見つかりません**: 「修復」を行います。

### 緊急停止

VC に音が流れ続けるときは、`Ctrl + Alt + Shift + X` ですべての再生を止めます（Discord の画面が固まっていても効きます）。止まらなければ Discord を終了してください。エンジンが終わると、マイクの送信は元に戻ります。

### 公式 Vencord に戻したい

インストーラで「解除する」を行ってから、公式の Vencord インストーラで入れ直してください。設定（`%APPDATA%\Vencord`）は共有なので、そのまま使えます。
