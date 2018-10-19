# Changelog

## v0.3.0

- Add `--useMemory` option to avoid emitting temporal output files
- Fixes the option `-p` to allow directory name without trailing `/`
- Improves watch mode for TypeScript, using original tsconfig.json instead of parsed config data (to detect added/renamed/deleted files)
  - `WatchInstance` object now provides `updateTsFiles` method for using `TscConfig` object
- Fixes source file emittion for webpack to interpret correctly

## v0.2.0

- Support for specifying additional loaders to apply for TypeScript files

## v0.1.1

- Fix invalid dependencies

## v0.1.0

- Initial version
