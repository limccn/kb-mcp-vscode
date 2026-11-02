# Runtime binaries

`hyseed.exe` and `doc-convert.exe` are not stored in git: together they are about 70 MB. The VSIX
already bundles both, so end users installing from the Marketplace or Open VSX do not need this
directory.

## Download for a source build

Download the Windows x64 binaries from the **v0.2.0** GitHub release:

<https://github.com/limccn/kb-mcp-vscode/releases/tag/v0.2.0>

If the release is not published yet, open the
[Releases page](https://github.com/limccn/kb-mcp-vscode/releases).

Place both files in this directory:

```text
resources/
├── hyseed.exe
└── doc-convert.exe
```

Then run `npm run package` as usual. You can also keep the files elsewhere and point the build at
them:

```bat
set HYSEED_RUNTIME_EXE=C:\path\to\hyseed.exe
set DOC_CONVERT_EXE=C:\path\to\doc-convert.exe
npm run package
```

## Checksums (v0.2.0)

| File | SHA-256 |
|---|---|
| `hyseed.exe` | `1eb2cfe1c02558d90fafc71bf87f48fa9b40d52199fec83f2a4722cf9ffe0f94` |
| `doc-convert.exe` | `87bb6ae09c2b7fc00669261e4ba4fbf8aa863c5ac200cffc0ea27a952f2cbceb` |