[![NPM version](https://badge.fury.io/js/tsc2webpack.svg)](https://www.npmjs.com/package/tsc2webpack)

tsc2webpack
==========

(Beta) A build tool that calls TypeScript compiler and webpack process sequentially.

## When to use

Usually, when packing TypeScript files with webpack, using the webpack loader for TypeScript files such as `ts-loader` or `awesome-typescript-loader` is one of the easiest ways. If you are not familiar with webpack, I recommend to use those loaders instead of tsc2webpack.

tsc2webpack simply executes TypeScript compiler and webpack (watch mode is supported). This intends to speed up execution by compiling all TypeScript files first rather than using loaders, which compiles file by file.

## Install

tsc2webpack requires typescript (version: >= 2.7) and webpack (version: 4.x).

```
npm install -D typescript webpack tsc2webpack
```

## Usage (CLI)

```
Usage:
  tsc2webpack [-p <tsconfig.json>] [-c <webpack.config.js>] [<options...>]

  * If tsconfig.json is omitted, tsc2webpack searches 'tsconfig.json'
    from the current directory.
  * If webpack.config.js is omitted, tsc2webpack loads 'webpack.config.js'
    with the expression 'require(path.resolve("webpack.config.js"))'.

Options:
  --help, -h, -?               Show help and exit                      [boolean]
  --tsconfig, -p, --project    The project file or directory for TypeScript
                               tsconfig.json                            [string]
  --webpackConfig, -c, --conf  The webpack configuration JavaScript file
                               (usually webpack.config.js)              [string]
  --watch, -w                  Start watch processes when build finished
                                                                       [boolean]
  --tempBuildDir, --tempDir    Temporal output directory for emitted JS files
                               from TypeScript compiler                 [string]
  --useMemory, --mem           Enables 'in-memory temporal build' mode [boolean]
  --emitDeclarations, -d       Enables to emit declaration files as assets of
                               webpack                                 [boolean]
  --lang, --locale             The locale/language for TypeScript messages
                                                                        [string]
  --verbose, -v                Enables verbose logging mode            [boolean]
  --version, -V                Show version number and exit            [boolean]
```

### Options

#### --help, -h, -? (boolean)

Shows the usage.

#### --project, -p (string)

Specifies the TypeScript project file (such as tsconfig.json) or the directory path.
If omitted, `'./tsconfig.json'` will be used (same as the TypeScript's `tsconfig.json` search process).

NOTE: `outDir` compiler option of `tsconfig.json` is used for emitted (compiled) JavaScript files unless `tempBuildDir` option is specified.

#### --webpackConfig, -c, --conf (string)

Specifies the webpack configuration JavaScript file (such as webpack.config.js).
If omitted, tsc2webpack executes `require(path.resolve('webpack.config.js'))` to load the configuration.

NOTE: before execution, remove loaders for TypeScript files in the webpack configuration (tsc2webpack automatically appends the internal loader to replace TS files).

#### --watch, -w (boolean)

Specifies if using 'watch' mode (using 'watch' mode of TypeScript compiler and webpack). While both watch processes of TypeScript compiler and webpack will run at the same time, the first build process is executed sequentially (TypeScript -> webpack).

#### --tempBuildDir, --tempDir (string)

Specifies the temporal output directory for emitted JS files from TypeScript compiler. If specified, this overrides `outDir` compiler option of `tsconfig.json`.

When webpack process runs, all entry points and modules referring each TypeScript source files in `tsconfig.json` are replaced by the each JS files in `tempBuildDir`.

#### --useMemory, --mem (boolean)

Enables 'in-memory temporal build' mode, which temporal output data (JS file content) is kept in the memory instead of file system. If the flag is set to true, 'tempBuildDir' is ignored and 'outDir' TypeScript compiler option is also ignored.

#### --emitDeclarations, -d (boolean)

Enables to emit declaration files as assets of webpack. Use this flag if some plugins, specified in the webpack configuration, gather declaration files.

NOTE: No declaration files will be emitted unless 'declaration' flag in the tsconfig.json is true.

#### --lang, --locale (string)

Specifies the language (locale) for TypeScript compiler messages. (Currently other messages are outputted in English.)

#### --verbose, -v (boolean)

Enables the verbose mode (detailed logs / messages will be outputted).

#### --version, -V (boolean)

Shows the version number.

## Applying additional loaders for TypeScript files

tsc2webpack uses an internal loader for webpack to load TypeScript files as JavaScript files.
If additional loaders such as `babel-loader` are necessary, use `AdditionalLoadersPlugin` as followings:

```js
const AdditionalLoadersPlugin = require('tsc2webpack').AdditionalLoadersPlugin;

// webpack configuration
module.exports = {
    ... // existing settings
    plugins: [
        new AdditionalLoadersPlugin(
            // 'head' loaders (optional parameter; can be null)
            [{
                loader: 'babel-loader',
                options: { presets: ['@babel/preset-env'] }
            }],
            // 'tail' loaders (optional parameter; can be null)
            []
        )
    ]
};
```

NOTE: In webpack, loaders in 'use' array are applied in reverse order (from tail to head).
In above case, `babel-loader` *is appended before* tsc2webpack's internal loader in the configuration,
and `babel-loader` *is applied after* the internal loader.

## Examples

```
tsc2webpack -p ./tsconfig.json -c ./build/webpack.config.js
```

## API

Type definitions are available in `dist/index.d.ts` (defined in package.json). Please refer to the type definitions to see detailed API descriptions.

```js
import {
    // functions
    execute,
    watch,
    setWebpackStatsOptions,
    createWebpackFunction,

    // objects
    TypeScriptError,
    WebpackError
} from 'tsc2webpack';
```

### Functions

#### `execute`, `watch`

These functions simply executes TypeScript compiler and webpack process. `watch` function is for watch mode.

* For the parameter `tsconfig` as an object, please see [`TscConfig` interface](./src/main/types/TscConfig.ts).
* For the parameter `options`, please see [`Options` interface](./src/main/types/Options.ts).

#### setWebpackStatsOptions

This function affects to the loggings. The log messages are only outputted via `logInfo`, `logVerbose`, and `handleError` methods in the `handles` object of `options` parameter.

#### createWebpackFunction

This function returns wrapped `webpack` function, calling TypeScript compiler before real webpack process. For example, you can specify the return value as a second parameter of `webpack-stream`.

### Objects

#### TypeScriptError, WebpackError

These objects are thrown when TypeScript compilation or webpack process is failed with error. `handleError` method in the `handles` object of `options` parameter will may catch the errors, so you can check and see detailed information from properties of the errors.

## License

MIT License
