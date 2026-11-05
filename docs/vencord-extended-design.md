# vencord-extended 設計書

Nov 4, 2026 · @uta\_a

## 概要と目的

vencord-extended は Vencord を fork し、voicecord-module の音声注入機能を **Vencord の組み込みプラグイン「VoiceCord」** として同梱する Windows 向け Discord クライアント mod です。1 回のパッチで、Vencord の全プラグインと VoiceCord が同じ基盤の上で動きます。

目指すこと:

1. **導入を 1 つにする。** 今の「Vencord + VoiceCord を連鎖 shim でつなぐ」構成をやめ、patcher も preload も 1 系統にする
2. **UI を壊れにくくする。** DOM の接ぎ木と CSS クラス名の採取をやめ、Vencord の webpack パッチと Discord 純正コンポーネントで描画する
3. **upstream に追従し続ける。** Vencord 本体への変更を数ファイルに抑え、VoiceCord のコードはプラグインと専用ディレクトリに閉じ込める
4. **Vencord プラグインとの互換を保つ。** プラグイン API には手を入れず、公式プラグインと userplugins がそのまま動く状態を維持する

## 前提・スコープ

対象は Windows x64 の Discord デスクトップ版だけです。Krisp フックと frida が Windows 前提のため、VoiceCord 部分は他環境のビルドから外します。

| 項目 | 対象 | 対象外 |
| --- | --- | --- |
| クライアント | Discord デスクトップ（開発は Canary、Stable は検証後） | Web 版、ブラウザ拡張版、Vesktop |
| OS | Windows x64 | macOS / Linux（Vencord 部分は動くが VoiceCord は無効） |
| VoiceCord の機能 | 現行 v0.3.1 の全機能（サウンドボード、試聴、音源別音量、声の校正、モニター、入場サウンド、他サーバーのサウンド取得、緊急停止） | 新機能の追加（移植完了後に検討） |
| Vencord | upstream の公式プラグイン・userplugins・テーマ・更新機能 | Vencord のプラグイン API の変更 |

動作の前提:

- Discord のノイズ抑制が Krisp。注入先は Krisp 処理後の renderer（`KrispNCProcessFloat` の出力バッファ）
- メインウィンドウが `sandbox:false`。Vencord の patcher が常に強制するので、現行の「Discord 自身が sandbox を切っている」という前提に依存しなくなる
- frida 16.x のネイティブランタイム（約 75 MB）を配布物に含める
- ライセンス: Vencord は GPL-3.0-or-later。fork 全体が GPL-3.0-or-later になり、同梱する VoiceCord のコードも GPL-3.0-or-later で公開する（fork のルートの LICENSE に従う）。frida は wxWindows Library Licence のため、バイナリの同梱に問題はない

## 現状分析

両者は「app.asar を差し替えて main プロセスで動き、preload から renderer に UI を出す」という同じ型です。そのため、VoiceCord の main 側は Vencord のプラグイン native にそのまま載せられます。一方 renderer 側は作り方が違うため、大きく書き換えます。調査対象は Vencord 1.15.15（commit 8d64c8b、2026-10-30）と voicecord-module 0.3.1 です。

### Vencord の構造

| 層 | 場所 | 役割 |
| --- | --- | --- |
| main | `src/main/patcher.ts` | BrowserWindow をサブクラス化して preload を差し替え、`sandbox:false` を強制する。最後に `require(main)` で Discord 本体をブートする |
| main | `src/main/ipcPlugins.ts` | 各プラグインの `native.ts` の export を `VencordPluginNative_<plugin>_<method>` として `ipcMain.handle` に登録する |
| preload | `src/preload.ts` | `VencordNative` を contextBridge で公開し、renderer.js をメインワールドへ流し込む |
| renderer | `src/webpack`, `src/plugins` | webpack モジュールの文字列パッチ、find API、プラグイン設定 |
| build | `scripts/build/build.mjs` | `plugins/` と `userplugins/` の native.ts から `~pluginNatives` を自動生成。成果物は patcher.js / preload.js / renderer.js / renderer.css の 4 つ |
| updater | `src/main/updater` | git remote の GitHub Releases から上記 4 ファイルを取得する |

制約が 1 つあります。プラグイン native は invoke 専用で、main から renderer への push がありません。push を使えるのは QuickCSS などコアのイベントだけです。VoiceCord はエンジンの状態や再生終了を受け取る必要がありますが、コアには手を入れず、invoke を保留する long-poll で代替します（「IPC と API 設計」を参照）。

### voicecord-module の構造と移植先

| ディレクトリ | 動く場所 | 役割 | vencord-extended での扱い |
| --- | --- | --- | --- |
| `src/agent/hook.js` | 注入先 renderer（frida） | Krisp 出力へのミックス注入 | 変更なし |
| `src/engine` | utilityProcess の子 | 注入先の探索、hook 注入、再アタッチ監視 | ほぼそのまま。別バンドル `engine.mjs` |
| `src/shared` | 両側 | 型、設定、音量計算、パス | そのまま共有 |
| `src/patcher` | Discord main | 設定、音源走査、サウンドボードのキャッシュ、エンジン起動、IPC、preload 登録 | プラグイン native へ移植。preload 登録と `voicecord:*` チャンネルは廃止 |
| `src/preload` | isolated world | `window.api`、PCM デコード、DOM 接ぎ木、FAB、キーボード | API とデコードは renderer プラグインへ。接ぎ木は廃止し、FAB は予備として残す |
| `src/mainworld` | メインワールド | webpack から CSS クラス名を読む | 廃止。Vencord の `findByProps` で代替 |
| `src/ui` | isolated world（React 18 + Tailwind + Radix + zustand） | サウンドボード UI | store は流用。部品は Discord 純正のものへ置き換え |
| `src/manager` | 独立した Electron アプリ | Discord の検出、app.asar の連鎖 shim 化、復旧 | vencord-extended のインストーラとして流用 |

現行の連鎖 shim には「Vencord より先に VoiceCord の patcher を require する」という順序の制約があります。Vencord が末尾で Discord をブートするためです。fork に取り込めば初期化は patcher 内で順序どおりに走るので、この制約はなくなります。

## 統合方式の比較と採用案

**採用案は B（Vencord の組み込みプラグイン化）です。** エンジンと frida はプラグインの外に置き、fork 独自のコアとして扱います。

| 案 | 内容 | 利点 | 問題 |
| --- | --- | --- | --- |
| A. 別モジュール同梱 | Vencord の patcher から現行の voicecord patcher.js / preload.js を require する | 移植量がほぼ 0 | preload と UI が 2 系統のまま。Vencord の設定に出ず、DOM 接ぎ木の脆さも残る。fork する意味が薄い |
| **B. 組み込みプラグイン（採用）** | main 側はプラグイン native、エンジンは別バンドル、UI は Vencord プラグイン | Vencord の設定画面・webpack パッチ・更新機構をそのまま使える。プラグインのオンオフも可能 | UI の書き換え量が多い（store 以外の部品） |
| C. fork しない userplugin | 公式 Vencord に入れる userplugin として配布する | fork の保守が不要 | engine.mjs と frida ランタイムを userplugin のビルドで配置できない。導入には利用者自身のソースビルドが必要 |

B を選ぶ理由:

- 現行のいちばん壊れやすい部分は、DOM 接ぎ木、CSS 採取、再挿入の上限制御です。B ならこれが丸ごと消えます
- 音声経路（engine / hook）は実機検証済みです。そこには手を入れず、移植のリスクを UI 側に集められます
- コア改変はビルド、更新処理、ブランド表記と非公式表記に限られます。push は long-poll にしてプラグイン内に収めます

A は移行途中の足場としてだけ使います。M1 で音声経路が動くまでは、現行 UI を一時的に併用しても構いません。

## 全体アーキテクチャ

&#91;embedded content: プロセス構成 · main / renderer / utilityProcess\]

UI と設定は Vencord の仕組みに乗せます。音声経路（engine → frida → hook.js → Krisp の出力）は現行のままです。frida は utilityProcess の中だけで読み、Discord の main と renderer には載せません。

## リポジトリ・ディレクトリ構成

VoiceCord のコードは `src/voicecord/`（コア）と `src/plugins/voiceCord.discordDesktop/`（プラグイン）の 2 か所に置きます。Vencord 本体の既存ファイルへの変更は、下の「コア改変」に限ります。フォルダ名の `.discordDesktop` は Vencord の規約で、Discord デスクトップ版のビルドにだけ含める指定です。

```
vencord-extended/
├─ src/plugins/voiceCord.discordDesktop/   プラグイン本体
│  ├─ index.tsx        definePlugin（patches / settings / start / stop）
│  ├─ native/index.ts  main 側の入口。ipcPlugins が自動登録する
│  ├─ native/          config, soundsFs, soundboardCache, engineHost,
│  │                    locate, vcStatus, subsystems（旧 src/patcher）
│  ├─ api.ts           window.api の後継。pluginHelpers と long-poll を包む
│  ├─ store.ts         旧 src/ui/store.ts（zustand/vanilla）と useVoiceCord フック
│  ├─ audio/           decode, localAudio, calibration, sourceScan
│  ├─ components/      SoundboardTabs, SoundboardPopout, NowPlaying, LevelDialog,
│  │                    EntrySoundDialog, SettingsSections, Fab
│  └─ style.css        接頭辞 vc-voicecord-、Discord の CSS 変数を使う
├─ src/voicecord/                           fork 独自のコア
│  ├─ engine/          engine, supervisor, injector, transmit, core
│  ├─ agent/hook.js    frida エージェント（変更なし）
│  └─ shared/          types, engineMsg, config, loudness, paths, status
├─ scripts/build/voicecord.mjs              engine.mjs / hook.js / frida ランタイムの生成
├─ installer/                               VoiceCord Manager 由来のインストーラ
├─ test/voicecord/                          移植した Vitest
└─ FORK_CHANGES.md                          コア改変の一覧（CI で検査）
```

**コア改変の定義:** upstream 由来のファイルへの変更は、すべてコア改変とみなします。push は long-poll にしたため、`VencordNative.ts`、`IpcEvents.ts`、`ipcPlugins.ts` には手を入れません。想定するコア改変は次のとおりです。

| ファイル | 変更内容 |
| --- | --- |
| `scripts/build/build.mjs` | VoiceCord のビルド対象を追加。無効化フラグ付き |
| `src/main/updater/common.ts` ほか更新処理 | ランタイムの版確認と取得を追加（`VENCORD_FILES` は 4 つのまま） |
| `package.json` | frida の依存、版表記（`-ext.<連番>`） |
| `pnpm-workspace.yaml` | `allowBuilds` に frida を追加 |
| ブランド表記（設定画面の見出し、User-Agent） | 「Vencord Extended」にする。`Vencord` / `VencordNative` などの識別子は互換のため変えない |
| `supportHelper`、README | 非公式 fork であること、Vencord 公式に報告しないことを明記 |

- 一覧は `FORK_CHANGES.md` に置く。CI で `git diff --name-only upstream/main` の結果（VoiceCord 専用ディレクトリを除く）と突き合わせ、一覧にない変更があれば失敗させる
- コードの改変箇所には `// vencord-extended:` のコメントを付け、マージ時に検索で拾えるようにする

## main プロセス側の設計

旧 `src/patcher/index.ts` のサブシステム構成をそのまま native に移します。ただし preload 登録と Discord のブートは Vencord が担うので削除します。

### 初期化のタイミング

native モジュールは patcher.js に束ねられ、Discord の起動直後に読み込まれます。プラグインが無効でも読まれるため、トップレベルでは何も起動しません。

1. トップレベルで `RendererSettings.store.plugins.VoiceCord?.enabled` と `process.platform === "win32"` を確認する。両方満たすときだけ `app.whenReady()` 後にサブシステムを起こす（エンジンは VC 参加前から常駐させる。実機検証済みの挙動を変えないため。メモリやウイルス対策ソフトの誤検知が問題になれば、M5 で VC 参加時の遅延起動を検討する）
   - プラグインは `enabledByDefault: true`。設定に項目がまだない初回起動時も有効として扱う
2. renderer 側の `start()` は native の `ensureStarted()` を呼ぶ。実行中にプラグインを有効にした場合の入口で、冒等にする
3. `stop()` は `shutdown()` を呼ぶ。全停止し、ゲートを戻してからエンジンを終了する
4. Vencord の vanilla モード（`IS_VANILLA`）では何もしない

### サブシステム

| 名前 | 内容 | 失敗時 |
| --- | --- | --- |
| config | 音源フォルダ（複数）、音源別音量、校正値、入場サウンドの保存。既定フォルダは自動作成。単一フォルダの時代の設定は読み込み時に移す | 設定 API が理由付きで throw |
| engine | `utilityProcess.fork(<dist>/voicecord/engine.mjs)`。frida はこの子の中だけで読む | status.engine = failed |
| ipc | native 関数の実体。フォルダ外のファイル読み取りを拒否する制限も維持 | 該当 API が理由付きで throw |

旧 patcher の state（「mod が最後に動いた日時」の記録）は移植していません。Discord の更新後の再パッチは Vencord が行うので、パッチ外れの判定が必要になったら足します。ipc は native の export そのものになり、ほかのサーバーのサウンドのキャッシュは soundboard として独立させました。

`runSubsystems` の「1 つが落ちても他は動かす」方針、失敗を `status.degraded` で UI に返す方針はそのままです。

### 設定の置き場

- オンオフやショートカットなど小さい設定は Vencord の `definePluginSettings` に置き、Vencord の設定画面に出す
- 音源別音量など大きく頻繁に変わるものは、従来の config.json を `<DATA_DIR>\voicecord\config.json` に置く。Vencord の settings.json は変更のたびに全体を書き出すためです
- `DATA_DIR` は公式 Vencord と共有する（`%APPDATA%\Vencord`）。既存のプラグイン設定、QuickCSS、テーマがそのまま引き継がれる。公式版に戻したときは `voicecord\` と VoiceCord の設定が残るが、Vencord は知らないプラグインの設定を無視するので実害はない
- dist は共有しない（「インストーラ」を参照）
- 初回起動時だけ `%LOCALAPPDATA%\VoiceCord\config.json` を読んで移行し、元のファイルは消さない

### エンジンと frida の配置

- `engine.mjs` は frida を external にした ESM バンドル（utilityProcess の子として Node のローダに読ませる。移植元と同じ形）。frida は `bindings` が `package.json` と `build/` を辿るため、束ねずに `<dist>/voicecord/node_modules/frida` に置く
- hook.js と注入先の探索（自分と親が同じ renderer、不合格に期限を付ける処理）は変更しない
- 注入レートは hook が実測する。実測値は Canary 1.0.1169 で 32 kHz / 320 サンプル、Stable 1.0.9257 で 48 kHz / 480 サンプル。固定値を前提にしない
- `before-quit` でエンジンを止める。子側は parentPort の close でもゲートを戻す

## IPC と API 設計

renderer から main への呼び出しは Vencord 標準の `VencordNative.pluginHelpers.VoiceCord.<method>()` に寄せます。main から renderer への通知も、コアに push を足さず、同じ仕組みの上の long-poll で実現します。現行の `voicecord:*` チャンネルは廃止します。

### invoke（renderer → main）

native 関数は第 1 引数に `IpcMainInvokeEvent` を受け取ります。それ以外の引数と戻り値は現行の `CH` と同じ形にし、`src/voicecord/shared` の型を両側で共有します。

| 旧チャンネル | native 関数 | 備考 |
| --- | --- | --- |
| `getStatus` / `subscribe` | `getStatus()` / `nextEvents(cursor)` | getStatus は再生中の一覧も返す。subscribe は long-poll の nextEvents に置き換える |
| `getConfig` / `saveConfig` | `getConfig()` / `saveConfig(partial)` | 保存失敗は reject で返し、UI で通知 |
| `scanFolder` / `chooseFolder` / `readSoundFile` | `scanSoundFolder()` / 同名 / 同名 | readSoundFile は ArrayBuffer を切り出して返す |
| `fetchSoundboardSound` | 同名 | CDN 取得は main 側のまま（renderer の CSP を避ける） |
| `preload` | `preloadPcm(sourceId, fp, sampleRate, pcm)` | PCM は ArrayBuffer で渡す（utilityProcess へは transfer できないので複製）。PCM 自身のレートと内容指紋を必ず添える |
| `play` / `stop` / `stopAll` / `setVoiceVolume` / `setMaster` / `openGate` | 同名 | エンジンへそのまま中継 |
| `calibStart` / `calibStop` | 同名 | 音量校正 |
| `reattach` / `detach` | 同名 | 手動リトライ用 |
| — | `ensureStarted()` / `shutdown()` | プラグインの start / stop から呼ぶ（新規） |

### 通知（main → renderer）の long-poll

コアに push は足さず、プラグイン native の invoke をイベントが来るまで保留する方式で通知を受け取ります。プラグイン API の範囲に収まるため、upstream と衝突する箇所が増えません。

```ts
// native
nextEvents(cursor: number): Promise<
    | { cursor: number; events: VoiceCordEvent[] }
    | { reset: true; cursor: number }
>
```

- main 側に、全体で 1 つのリングバッファ（連番付き、500 件）を置く。`cursor` より新しいイベントがあれば即座に返し、なければ次のイベントが来るまで Promise を保留する。25 秒待っても来なければ空で返し、永久には保留しない
- `cursor` が `null`、バッファから落ちている、または未来を指している（main の再起動後）ときは `{ reset: true }` を返す。renderer は `getStatus()` で状態を丸ごと取り直し、返された cursor から再開する。Ctrl+R による再読み込みの直後も同じ扱いにする
- renderer 側のループ（`api.ts`）は、失敗したら 1 秒おいて再試行し、プラグインの stop() で止める
- `status` と `engine` は `getStatus()` のスナップショットで復元できればよい。`log` は欠けても構わない。再生終了の通知が欠けて「再生中」の表示が残らないよう、`getStatus()` は再生中の一覧も返す
- 保留中の Promise は webContents ごとに管理する。webContents が破棄されたら、該当する Promise を解決して片付ける
- 遅延は 1 往復ぶん（数 ms 程度）増えるが、UI の用途では問題にならない
- ペイロードは現行の `VoiceCordEvent`（`status` / `log` / `engine`）をそのまま使う。IPC を通るため、構造化クローン可能な値だけにする

### PCM の流れ

1. renderer（メインワールド）が `readSoundFile` で生ファイルを受け取る
2. Web Audio（`OfflineAudioContext`）でデコードし、モノラル化する（左右に 0.5 ずつ）。出力レートが既知なら、そのレートへ先に変換する
3. `preloadPcm` で main へ送る。main は utilityProcess へ postMessage し、engine が frida の `post` で hook に渡す

この経路は現行と同じです。変わるのは、デコードが isolated world ではなくメインワールドで動く点だけです。メインワールドでも Web Audio は使えます。

## renderer・UI 統合

UI は Vencord プラグインとしてメインワールドで動かし、Discord の React と純正コンポーネントで描画します。現行の isolated world 用の仕組み（採取役、接ぎ木、自前の React、Tailwind）は廃止します。Shadow DOM で現行 UI を維持する案は採りません。長く保守する前提では、テーマへの追従と Vencord との一体感のほうが効くためです。その代わり、M3 が移植で最大の山場になります。

### サウンドボードのタブ

音声パネルにボタンは足さず、純正サウンドボードのポップアウトに「サウンドボード / VoiceCord」のタブを付ける（2026/11/5 に方式を変更。M2〜M3 では純正サウンドボードボタンの隣にボタンを差し込んでいた）。

- 音声パネルのサウンドボードボタンが開くポップアウトの中身（純正のサウンド一覧）を、Vencord の `patches` で `$self.renderSoundboardTabs(中身)` に包む。Canary 1.0.1304 で調べて決めた
  - find: `"CUSTOM_CALL_SOUNDS_PICKER_UPSELL&&"`（ポップアウトの gridNotice の条件。全モジュールで一意）
  - match: `/\(0,\i\.jsx\)\(\i\.\i,\{guildId:\i,channel:\i,onClose:\i,gridNotice:.{0,150}?analyticsSource:"rtc panel"\}\)/`（中身の要素全体）
- タブは絵文字ピッカー（GIF・スタンプ・絵文字・サウンドボード）のタブと同じクラス（`nav` / `navList` / `navItem` / `navButton` / `navButtonActive`）で描く。枠は純正と同じ `picker` クラスで、中身の高さも純正と同じ 420px にそろえ、タブを切り替えても大きさを変えない
- 最後に開いていたタブを覚え、次に開いたときもそのタブから始める（Discord を再起動すると「サウンドボード」に戻る）
- Discord のキーバインド（サウンドボードを開く）でも同じポップアウトが開くので、タブもそのまま付く
- タブの描画に失敗したら、ErrorBoundary で純正の中身だけを返し、サウンドボード自体は使えるままにする
- Discord の CSS モジュールは書き出しのキーも短縮されている（`uu:"actionButtons_e131a9"`）ため、`findByProps("actionButtons")` は使えない。代わりに `findCssClassesLazy` でクラス名の接頭辞から引く
- パッチが当たらなかった場合は予備の FAB を出す。パッチ済みのソースは開発ビルドでしか残らないため、置き換えを関数で書き、当たった時点で印を付ける。VC に入って 5 秒たっても印が無ければ故障と判定し、画面右下に FAB を出して理由をツールチップで示す

### サウンドフォルダ（複数）

2026/11/5 に、サウンドフォルダを複数持てるようにした。純正サウンドボードがサーバーごとにサウンドを分けるのと同じ見た目で、フォルダごとに分けて並べる。

- 設定は `folders: string[]`。並び順がそのまま表示順。空にもできる。重複（大文字小文字・区切りの違い）は読み込みと保存のたびに落とす
- サウンドの ID は「フォルダの鍵 | フォルダ内の名前」（`shared/soundId.ts`）。鍵は区切りをスラッシュにそろえて小文字にしたパス。`|` は Windows のパスにもファイル名にも使えないので取り違えない。フォルダを外したり並べ替えたりしても、ほかのフォルダの ID（音源別音量・入場サウンドのキー）は変わらない
- 単一フォルダの時代の設定（`folders` が無い）は、読み込み時に `folder` を `folders` の 1 つ目に移し、音源別音量と入場サウンドのキーをそのフォルダの ID に直す。旧来の `folder` は残さない（このため、古いビルドに戻すと既定のフォルダに戻る）
- 一覧は、左に純正と同じバー（フォルダ名の頭文字・選択中の印・末尾の「＋」で追加）、右にフォルダごとのセクション（見出しを押すと畳む）。クラスは純正サウンドボードの `category` / `categoryPill` / ピル / `guildIcon` を使う
- 検索中は一致の無いフォルダを出さない。畳んだフォルダは Discord を再起動するまで覚える
- 設定画面にフォルダの一覧を出し、追加・上下の並べ替え・外すをできるようにした。外してもファイルと音量の設定は消さない

### ポップアウトと部品

| 現行 | 移行先 |
| --- | --- |
| `#vc-root` への自前ポータル | 純正サウンドボードのポップアウトのタブ（予備の FAB では Discord の `Popout`） |
| ポップアウトの器・見出し・行・タイル | 純正サウンドボードのクラス（`picker` / `sectionHeader` / `soundRow` / `soundButton` と操作の帯）を `findCssClassesLazy` で引いて使う |
| Radix の Dialog | Discord の新しい `Modal`（`@webpack/common`。タイトル・サブタイトル・下部のボタン付き） |
| Radix の Slider / Select | Discord の `Slider` / `Select`。Slider は `markers` に下限・上限を必ず含める（含めないと範囲が崩れる） |
| Radix の Switch | Vencord の `Switch` / `FormSwitch`（Discord のトグル本体は設定画面でしか読み込まれず、安定して引けない） |
| shadcn の Button / Input | Discord の `Button`（`Looks` / `Colors` / `Sizes` を持つもの）と、純正サウンドボードと同じ `SearchBar` |
| 文字 | Discord の `Text`（`variant` は `body-sm/semibold` など、画面で実際に使われているもの） |
| Tailwind + shadcn の配色 | `style.css` は寸法と並べ方だけ。色は Discord の CSS 変数に任せる |
| sonner のトースト | Discord の `showToast`（store の通知の連番を見て、同じ文言でも毎回出す） |
| zustand の store（1272 行） | ロジックは流用し、`zustand/vanilla`（React 非依存）で作る。React との接続は `@webpack/common` の `React.useSyncExternalStore` を包む自前の `useVoiceCord(selector)` で行う（`import "react"` を束ねると React が 2 つになるため）。api は `bindApi` で受け取り、プラグインの stop で `resetStore` する |
| lucide-react のアイコン | Vencord の `@components/Icons` にあるもの（歯車・フォルダ・再読込）は使い、無いものだけ SVG を同梱 |

### 機能ごとの対応

| 機能（現行ファイル） | vencord-extended での実装 |
| --- | --- |
| 他サーバーのサウンドの解除（`lockedSounds.ts`） | 純正タイルの `onClick` の先頭をパッチで分岐させる（find: `/showLockForDisabledSound:\i=!0/`。match は `canUseSound` の否定とサウンドの変数を後読みで拾う）。鍵と Nitro の誘導は html の印と CSS で隠す |
| 純正サウンドボードの停止ボタン（`soundboardStop.ts`） | ヘッダーの `renderHeaderAccessories` をパッチで包み、音量アイコンの前に並べる（find: `"SoundboardSoundGrid"`） |
| VoiceCord で鳴らしている純正サウンドの再生中の枠 | サウンド ID ごとのセレクタを生成し、純正の再生中と同じ緑の枠を CSS で付ける |
| カメラボタン非表示（`cameraButton.ts`） | 設定で html に印を付け、音声パネルのボタン列（CSS モジュールの `actionButtons` クラス）の先頭を CSS で隠す（パネルの関数には途中で return する分岐があるので、パッチでフックは使えない） |
| VC 在席の判定（`presence.ts`） | `SelectedChannelStore` の変化を store へ渡し、hook の vc イベントと併用する |
| 入場サウンド | store のロジックのまま（hook の gateInfo で Connection* の張り替えを検知して鳴らす。flux の購読より誤発火が少ない） |
| 緊急停止 Ctrl+Alt+Shift+X（`keyboard.ts`） | renderer の keydown を維持。重ねて main 側の `before-input-event` でも捕まえる |
| 設定画面 | ポップアウト内の設定に加え、Vencord のプラグイン設定モーダルにも状態表示と復旧操作を置く |

## ビルド・配布・インストール・更新

配布物は、Vencord の 4 ファイルに VoiceCord のランタイム 1 つを足したものです。インストーラは VoiceCord Manager を改造して使います。

### ビルド

- `scripts/build/voicecord.mjs` を `build.mjs` から呼ぶ。`--no-voicecord` で全部飛ばす。engine.mjs と hook.js はどの OS でもビルドし（CI で束ね方の誤りに気付くため）、frida ランタイムは Windows で frida が入っているときだけ配る
- 成果物は `dist/voicecord/engine.mjs`（node20 / esm、frida は external）、`dist/voicecord/hook.js`、`dist/voicecord/node_modules/`（frida の `package.json` と `build/`、および bindings 系の依存 5 つ）
- コピーは現行の `copyIfChanged` を流用する。frida のバイナリは約 75 MB あるため、変わったときだけコピーする
- Vencord は pnpm を使う。frida の prebuild を通すため、`pnpm-workspace.yaml` の `allowBuilds` に frida を足す。frida は optionalDependencies に置き、Windows 以外で取得に失敗してもインストール全体を止めない。実行時依存は pnpm のリンク構造に依らず require の解決で辿る
- `buildWeb`（拡張機能版）では `.discordDesktop` の規約により自動で除外される。それを CI で確認する

### リリース物

| ファイル | 更新頻度 | 備考 |
| --- | --- | --- |
| patcher.js / preload.js / renderer.js / renderer.css | リリースごと | Vencord と同じ名前。native と UI もここに含まれる |
| `voicecord-runtime-win32-x64.zip` | engine / hook / frida が変わったとき | 中に `manifest.json`（ランタイム版の記録用） |
| `VencordExtendedInstaller-<version>.exe` | インストーラの変更時 | portable |

### 更新

- 更新元はビルド時の git remote から自動で `uta-a/vencord-extended` になる（`gitRemotePlugin`）
- `VENCORD_FILES` は 4 ファイルのままにする。ランタイムは、patcher.js に埋めた必要版と手元の manifest が食い違うときだけ取得する
- 必要版に加えて、zip の期待する sha256 もビルド時に patcher.js へ埋める。取得した zip はその値で検証する。zip 内の manifest は zip と同じ出どころなので、検証には使わない（手元の版の記録にだけ使う）
- 展開は一時フォルダで行い、検証が通ってから入れ替える。一致しなければ破棄し、status.engine = failed として理由を表示する
- 実行中のエンジンが frida の .node を掴んでいるため、入れ替えは次回起動時に行う
- Discord 本体の更新後に再パッチする処理は、Vencord の `persistAfterDiscordUpdates` をそのまま使う

### インストーラ

Vencord 公式インストーラは Vendicated のリリースを取りに行くため使えません。そこで VoiceCord Manager（`src/manager`）を改造します。

- 流用: Discord の検出（Stable / PTB / Canary / Development）、起動中の判定、「終了して適用」、asar の差し替えとバックアップ、計画後に変化があれば中断する安全策、復旧手順の配置
- 変更: 連鎖 shim をやめ、`require("<dist>/patcher.js")` だけの注入にする。配置先は `%LOCALAPPDATA%\VencordExtended\dist`
- dist は公式 Vencord と分ける。データディレクトリは共有するが、dist まで同じ場所にすると、公式インストーラで修復したときに fork の 4 ファイルが上書きされ、VoiceCord が無言で消えるため
- Go 製の公式インストーラを fork する案は採らない。shim の検出、変化時の中断、復旧手順の配置を作り直すことになるため
- 既存の Vencord や VoiceCord の shim を検出したら、二重に載せず置き換える。置き換え前に「これを外します」と表示する
- `pnpm inject` / `uninject` はこのインストーラの CLI モードを呼ぶように差し替える

### 開発ループ

`pnpm watch` で `dist/` を更新します。`%LOCALAPPDATA%\VencordExtended\dist` にはリポジトリの `dist` へのジャンクションを張ります。renderer は Ctrl+R、main と native は Discord の再起動で反映されます。

## upstream 追従の運用

Vencord の更新は「upstream/main を main へ merge する」形で取り込みます。公開履歴を書き換えないよう、rebase は使いません。

- リモート: `origin` = uta-a/vencord-extended、`upstream` = Vendicated/Vencord
- 頻度: Vencord のリリースごと。加えて Discord の更新でパッチが壊れたときは、upstream の修正をすぐ取り込む
- 自動化: GitHub Actions で毎日 upstream を取得し、merge したブランチでビルドとテストを回す。通れば PR を作る。衝突したら issue を立てる
- 衝突を減らす規則: VoiceCord のコードは `src/voicecord/` とプラグインフォルダに限る。コア改変は `FORK_CHANGES.md` に載せたものだけにし、各所は数行のフックに留める
- 互換性: プラグイン API、`Vencord` グローバル、設定ファイルの形式は変えない。userplugins は upstream と同じ手順で使える
- バージョン表記: `<Vencord の版>-ext.<連番>`（例: `1.15.15-ext.1`）。どの upstream が基になっているかを一目で分かるようにする
- 対外的な配慮: 不具合の報告先が upstream に向かわないようにする。`supportHelper` の表示と README に「非公式 fork。Vencord 公式に報告しないで」と明記する

## 障害時の振る舞いと安全設計

現行 VoiceCord の原則をそのまま引き継ぎます。**VoiceCord のどの部分が落ちても、Discord と Vencord は通常どおり起動する**ことです。

| 障害 | 振る舞い |
| --- | --- |
| native の初期化が throw | try/catch で握る。patcher.js の続き（Discord のブート）は必ず走る |
| engine.mjs や frida ランタイムがない・壊れている | status.engine = failed。UI は理由を表示し、更新時にランタイムを取り直す |
| エンジンが異常終了 | utilityProcess なので Discord は生き残る。バックオフ付きで再起動する。hook は parentPort の close でゲートを戻し、注入音が残らない |
| Krisp の export が見つからない | searching のまま待機し、「Krisp を有効にして」と表示する |
| タブのパッチが当たらない | 予備の FAB を出し、理由を表示する。他のパッチの成否には影響しない |
| プラグインが無効 | エンジンは起動せず frida も読まない。実行中に無効にしたら全停止して終了する |
| Vencord の vanilla モード | VoiceCord も動かさない |
| 再生が止まらない | 緊急停止（Ctrl+Alt+Shift+X）を renderer と main の 2 経路で受け付ける |
| Discord が起動しない | インストーラの「素の Discord に戻す」。インストーラも動かないときは、配置済みの復旧手順書（RESTORE.md を改訂）に従う |

その他の安全策:

- 注入する制御値は hook 側の `num()` ガードで常に丸める。音源別は最大 1.5、master は最大 4.0、同時再生は 8 音まで
- `readSoundFile` が読めるのは、設定の音源フォルダ（どれか）の配下とサウンドボードのキャッシュの決まった名前だけ。任意のパスは読まない
- native は他のプラグインからも呼べる。そのため、引数は型と範囲を main 側でも検証する
- README と初回起動時の表示（1 回だけ。プラグインの有効・無効に関わらず出す）で、非公式のクライアント改変であること、Discord の利用規約やアカウントへの影響は利用者が確認することを伝える

## テスト・検証計画

自動テストは「Vencord の既存チェック」と「移植した VoiceCord の Vitest」の 2 系統を CI で回します。実機検証は現行と同じく Canary と CDP で行います。

### 自動テスト

- Vencord の `pnpm test`（tsc、lint、standalone ビルド、web ビルド、プラグイン一覧生成）をそのまま通す
- 現行の 635 テストのうち、engine / supervisor / hook（Frida API の代替環境）/ config / loudness / soundsFs / soundboardCache / store を `test/voicecord/` に移す。接ぎ木・FAB・採取のテストは対象ごと廃止する
- 新規: long-poll（保留と解決、cursor があふれたときの reset、破棄された webContents の Promise の片付け）、プラグイン無効時にエンジンが起きないこと、設定の移行、ランタイムの版確認と sha256 の検証（patcher.js に埋めた値と一致しない zip を拒否する）
- `FORK_CHANGES.md` と `git diff --name-only upstream/main` が一致することを CI で検査する
- web ビルドの成果物に VoiceCord と frida が含まれないことを CI で検査する

### 実機検証（Canary）

- [ ] インストーラで適用し、Vencord の設定画面と公式プラグイン（FakeNitro、PlatformIndicators など）が動く
- [ ] 既存の Vencord / VoiceCord 導入済み環境からの置き換えで、二重に読み込まれない
- [ ] VC 参加後、純正サウンドボードのポップアウトに VoiceCord のタブが出る。チャンネル移動や再入場でも消えない
- [ ] 再生した音を別アカウントで受信し、速度とピッチが正しい（32 kHz / 48 kHz の両方）
- [ ] 音量校正、モニター、入場サウンド、他サーバーのサウンドが現行と同じ結果になる
- [ ] エンジンを kill すると注入音が止まり、自動で再アタッチする
- [ ] プラグインを実行中にオフ・オンしても Discord が落ちない
- [ ] ライト、ダーク、オニキス、および Vencord のテーマ適用中で見た目が崩れない
- [ ] Discord 本体の更新後に自動で再パッチされる
- [ ] 更新機構で 4 ファイルとランタイムが更新される
- [ ] 「素の Discord に戻す」と手作業の復旧の両方で元に戻る
- [ ] 24 時間の常用で、起動や VC に問題が出ない

## マイルストーン

音声経路を先に動かし、UI はその後に移します。各段階は完了条件を満たしてから次へ進みます。日程は未定です。

| 段階 | 内容 | 完了条件 |
| --- | --- | --- |
| M0 fork と土台 | fork、CI、upstream の自動取り込み、ブランド表記、インストーラの注入方式変更 | 自前のインストーラで入れた「VoiceCord なし」のビルドが Canary で動き、更新元が uta-a/vencord-extended になっている |
| M1 main 側の移植 | native、engine.mjs、hook.js、frida ランタイムのビルドと配置 | DevTools から `pluginHelpers` を呼んで再生した音を、別アカウントで受信できる |
| M2 通知と最小 UI | long-poll（`nextEvents`）、ボタンのパッチ、一覧・再生・停止だけのポップアウト、予備 FAB | VC 内のボタンから音源を選んで再生・全停止できる |
| M3 全機能の UI | 音量、校正、モニター、入場サウンド、他サーバーのサウンド、設定画面、設定の移行 | v0.3.1 の全機能が動き、旧 config.json が引き継がれる |
| M4 配布と更新 | リリースの自動化、ランタイムの更新、復旧手順書 | リリース物だけで導入・更新・解除・復旧ができる |
| M5 Stable と常用 | Stable での検証、24 時間の常用観察、エンジン常駐の見直し、旧 voicecord-module のアーカイブ | 実機検証の全項目が完了している |

## リスクと決定事項

### リスク

| リスク | 影響 | 対策 |
| --- | --- | --- |
| Discord の更新でタブのパッチが当たらなくなる | タブが消える | 予備 FAB。`find` は安定した文字列で当てる。upstream の修正もすぐ取り込む |
| Krisp の export 名やフレーム長（10 ms）が変わる | 注入できない、または速度が狂う | 現行と同じく実測レートで動かす。変わったら hook を再調査する |
| upstream との衝突 | 取り込みが遅れる | コア改変を `FORK_CHANGES.md` の一覧に限り、CI で検査する。毎日の自動 merge で早めに気付く |
| frida ランタイム（約 75 MB）の配布 | 初回導入が重い。ウイルス対策ソフトに誤検知されうる | 更新は版が変わったときだけにする。誤検知時の案内を README に書く |
| Vencord の「公式ではない」別物が混同される | upstream へ誤った報告が届く | ブランド表記と supportHelper で非公式 fork であることを明示する |
| 利用規約・アカウント | 利用者のアカウントに影響しうる | 現行と同じ注意書きを出す |

### 決定事項（2026-11-04）

未決事項はすべて解消しました。

| 論点 | 決定 |
| --- | --- |
| Modicord との関係 | vencord-extended を本命とし、Modicord 構想は凍結する |
| ライセンス | VoiceCord のコードも GPL-3.0-or-later で公開する |
| main → renderer の通知 | コア改変をやめ、long-poll（`nextEvents`）で実現する |
| UI | Discord 純正部品へ全面的に移行する。store は `zustand/vanilla` と自前のフック |
| データディレクトリ | `%APPDATA%\Vencord` を共有する。dist は `%LOCALAPPDATA%\VencordExtended\dist` に分ける |
| インストーラ | VoiceCord Manager を改造する |
| ランタイムの検証 | 期待する sha256 を patcher.js に埋めて検証する |
| エンジンの起動 | 起動直後から常駐させる。M5 で見直す |
| プラグインの既定 | `enabledByDefault: true`。初回起動時に注意書きを 1 回表示する |
| コア改変 | upstream 由来のファイルへの変更はすべてコア改変とし、`FORK_CHANGES.md` で管理する |
| Vesktop | 恒久的に対象外 |
| 旧 voicecord-module | M5 までは致命的な不具合の修正だけを入れ、M5 の完了時にアーカイブする。README で vencord-extended へ誘導する |
