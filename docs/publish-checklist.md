# Publish checklist

This file lists what must be decided or verified **before** a public release. The project does not
run `vsce publish` / `ovsx publish` anywhere; publishing is a manual, user-approved step.

## 1. Identity and metadata

- [x] `"publisher": "limccn"` in `package.json` (extension id: `limccn.kbmcp-vscode`).
      `check:docs` fails if the value is empty or still `placeholder-publisher`.
- [ ] Confirm the `limccn` publisher exists on each target registry (Marketplace publisher id,
      Open VSX namespace) and that the PAT belongs to it.
- [ ] `"repository"` is not set in `package.json`; the 0.2.0 build was published with
      `--allow-missing-repository`. If a public repository URL is confirmed, add
      `repository` / `bugs` / `homepage` before the next release and drop the flag.
- [ ] Confirm `displayName` (`hyseed`) and the `hyseed:` command prefix are final.
- [ ] Confirm `categories` / `keywords` / `icon` (`resources/icon.png`) in `package.json`.
      The activity bar uses separate 24×24 stroke-only line art (`resources/activitybar.svg`);
      VS Code masks it to the theme foreground, so it must not contain a filled background.
- [ ] Decide the version. Keep `CHANGELOG.md` and `package.json` in sync (`check:docs` enforces this).

## 2. Packaging

- [ ] `npm run check:docs` passes (10 checks, including the publisher gate and activity bar icon).
- [ ] `npm run package` succeeds; record the VSIX size and sha256. The build fails if the VSIX
      exceeds **100 MiB (104,857,600 bytes)**; the 0.2.0 build is 72,642,968 bytes / 13 entries
      (vsce reports 69.28 MB), sha256
      `6f13102d82f05e795419893e6987a623811ad61b52b33802c6bcb4d6c313d9c6`.
- [ ] `npx vsce ls` contains: `dist/extension.js`, `resources/hyseed.exe`,
      `resources/doc-convert.exe`, `resources/icon.png`, `resources/activitybar.svg`,
      `README.md`, `README.zh-CN.md`, `README.ja.md`, `CHANGELOG.md`, `LICENSE`; and excludes
      `src/`, `scripts/`, `test/`, `docs/`, `out/`, `portal/`, `node_modules/`.
- [ ] Install the VSIX into a clean profile and smoke-test activation:
      `code --install-extension <vsix> --extensions-dir <temp> --user-data-dir <temp>`.
      `code --list-extensions` must show `limccn.kbmcp-vscode`.
- [ ] Uninstall/remove the temporary directories afterwards.

## 3. Distribution channels

Both channels reuse the same `kbmcp-vscode-win32-x64-0.2.0.vsix` — the `win32-x64` target is baked
in at packaging time, so do not repackage per channel. Keep PATs in environment variables
(`VSCE_PAT`, `OVSX_PAT`); never write a token into this repository, a script, or a command line that
gets committed. Both CLIs read those variables by default, so no `--pat` argument is needed.

**VS Code Marketplace** (publisher id `limccn`; 0.2.0 published 2026-11-02):

```bat
npx vsce publish -i kbmcp-vscode-win32-x64-0.2.0.vsix --allow-missing-repository
```

**Open VSX** (namespace `limccn`, already created; current published version 0.1.1):

```bat
npx ovsx verify-pat limccn
npx ovsx publish kbmcp-vscode-win32-x64-0.2.0.vsix --allow-missing-repository
```

After the first publish, users install with `code --install-extension limccn.kbmcp-vscode`
(add `--extensions-dir` for a sandbox). Open VSX access is available to compatible editors such as
VSCodium; the extension id is the same.

**Intranet / offline**: share the VSIX directly; installation is
`code --install-extension <vsix>`. Windows x64 only.

## 4. Known constraints

- Windows x64 only; the VSIX bundles `hyseed.exe` (~21 MB) and `doc-convert.exe` (~52 MB).
- The 100 MiB limit is our hard gate. The Marketplace rejects very large packages, and Open VSX's
  hosted proxy currently allows up to 256 MB (server default 512 MiB) — neither changes our limit.
- The admin server has no authentication and binds `127.0.0.1` only.
- HTTP serving requires `KB_MCP_HTTP_TOKEN` in `%USERPROFILE%\.hyseed-http-token`
  (legacy `.kb-mcp-http-token` is reused when the new file is missing).
- The Marketplace renders `README.md`; `README.zh-CN.md` and `README.ja.md` are included for
  localized viewing and mechanical consistency checks.

## 5. Do not

- Do not run `vsce publish` or `ovsx publish` as part of the build or tests.
- Do not commit real credentials or token values.