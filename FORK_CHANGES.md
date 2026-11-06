# FORK_CHANGES

upstream（Vendicated/Vencord）由来のファイルのうち、vencord-extended が変更しているものの一覧です。
upstream から merge するときに衝突しうる場所はここに載っているものだけです。

- 新しく足したファイル（`installer/`、`docs/`、`src/voicecord/` など）は upstream と衝突しないので載せません
- コード中の改変箇所には `vencord-extended` のコメントを付けています
- CI（`.github/workflows/fork-checks.yml`）が `git diff --no-renames --diff-filter=MDT upstream/main...HEAD` とこの一覧を突き合わせます。一覧にない変更や、変更していない項目が残っていると失敗します

## 一覧

<!-- 形式: 「- `パス` — 理由」。CI はバッククォート内のパスだけを読みます -->

- `README.md` — 冒頭に非公式 fork の告知
- `package.json` — 版表記（`-ext.<連番>`）、`inject` / `uninject` をインストーラ CLI に差し替え、`buildInstaller` / `test:installer` / `test:voicecord` を追加、frida（optional）・vitest・zustand・postject の依存
- `pnpm-workspace.yaml` — catalog に frida・vitest・zustand・postject、`allowBuilds` に frida
- `pnpm-lock.yaml` — 上記の依存の追加（upstream の取り込みで衝突したら、upstream 側を採ってから `pnpm install` で作り直す）
- `scripts/build/build.mjs` — VoiceCord のエンジンと frida ランタイムのビルドを追加（本体は `scripts/build/voicecord.mjs`、`--no-voicecord` で無効化）。リリース（`--voicecord-release=<タグ>`）ではランタイムの zip を先に作り、その版・sha256・取得元を `VOICECORD_RUNTIME` として埋める
- `src/main/updater/http.ts` — 変更一覧を既定ブランチの先頭ではなく、最新リリースのタグまでの差にする
- `src/plugins/_core/settings.tsx` — 設定画面の見出しを Vencord Extended に
- `src/plugins/_core/supportHelper.tsx` — 公式サポートチャンネルでの fork の警告、debug 情報のリンク先
- `src/shared/vencordUserAgent.ts` — User-Agent を VencordExtended に
