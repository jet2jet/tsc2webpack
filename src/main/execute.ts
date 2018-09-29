
/// <reference types='node' />

import * as fs from 'fs';
import * as path from 'path';

import * as ts from 'typescript';
import * as webpack from 'webpack';

import TypeScriptError from './errors/TypeScriptError';
import WebpackError from './errors/WebpackError';

import Handlers from './types/Handlers';
import Options from './types/Options';
import TscBuildConfig from './types/TscBuildConfig';
import TscBuildResult from './types/TscBuildResult';
import TscConfig from './types/TscConfig';
import WatchInstance from './types/WatchInstance';
import {
	getTsBasePath,
	isTsProjectSourceFile
} from './utils/functions';
import { handleError, logInfo, logVerbose } from './utils/log';

/** @internal */
import './webpack/tsc2webpack-loader';
import WatchReplacePlugin from './webpack/WatchReplacePlugin';

const createProgramForWatching = ts.createSemanticDiagnosticsBuilderProgram;

// option for webpack logging
const webpackStatsOptions: webpack.Stats.ToStringOptionsObject = {
	colors: true,
	hash: false,
	timings: false,
	chunks: false,
	chunkModules: false,
	modules: false,
	children: true,
	version: true,
	cached: false,
	cachedAssets: false,
	reasons: false,
	source: false,
	errorDetails: false
};

function makeTscBuildConfigByFile(
	basePath?: string | null | undefined,
	tsconfig?: string | null | undefined,
	tempBuildDir?: string | null | undefined
): TscBuildConfig {
	let searchPath = basePath || './';
	let configName = 'tsconfig.json';
	if (tsconfig) {
		const p = path.resolve(searchPath, tsconfig);
		if (/[\\\/]$/.test(tsconfig)) {
			searchPath = p + path.sep;
		} else {
			const { dir, base } = path.parse(p);
			if (dir) {
				searchPath = dir;
			}
			configName = base;
		}
	}

	const configPath = ts.findConfigFile(
		searchPath.replace(/[\\\/]/g, '/'),
		ts.sys.fileExists,
		configName
	);
	if (!configPath) {
		throw `Could not find a valid '${tsconfig || configName}'.`;
	}

	const readResult = ts.readConfigFile(configPath, (path) => fs.readFileSync(path, 'utf8'));
	if (readResult.error) {
		throw new TypeScriptError(readResult.error);
	}
	const configDir = path.dirname(configPath);
	const parseResult = ts.parseJsonConfigFileContent(readResult.config, ts.sys, configDir);
	if (parseResult.errors && parseResult.errors.length > 0) {
		throw new TypeScriptError(parseResult.errors);
	}

	if (tempBuildDir) {
		parseResult.options.outDir = path.resolve(tempBuildDir);
	} else if (!parseResult.options.outDir) {
		parseResult.options.outDir = path.resolve('.tsw-work');
	} else {
		parseResult.options.outDir = path.resolve(configDir, parseResult.options.outDir);
	}

	return {
		configDirectory: configDir,
		data: {
			compilerOptions: parseResult.options,
			files: parseResult.fileNames
		}
	};
}

function makeTscBuildConfigByObject(
	basePath: string,
	tscConfig: TscConfig,
	tempBuildDir?: string | null | undefined
): TscBuildConfig {
	const result: TscBuildConfig = {
		configDirectory: basePath,
		data: {
			...tscConfig,
			compilerOptions: {
				...tscConfig.compilerOptions
			}
		}
	};
	if (tempBuildDir) {
		result.data.compilerOptions.outDir = tempBuildDir;
	}
	return result;
}

function executeTsc(config: TscBuildConfig, handlers: Handlers | undefined, locale?: string | undefined): TscBuildResult {
	const options: ts.CompilerOptions = { ...config.data.compilerOptions, locale };
	const host = ts.createCompilerHost(options);
	const program = ts.createProgram(config.data.files, options, host);
	const result = program.emit();
	if (result.diagnostics && result.diagnostics.length > 0) {
		throw new TypeScriptError(result.diagnostics);
	}
	handlers && handlers.onTsCompileFinished && handlers.onTsCompileFinished(config.data);
	return {
		...config,
		compilerHost: host
	};
}

function watchTsc(config: TscBuildConfig, handlers: Handlers | undefined, locale?: string | undefined): TscBuildResult {
	let watchStarted = false;

	const host = ts.createWatchCompilerHost(
		config.data.files,
		{ ...config.data.compilerOptions, locale },
		ts.sys,
		createProgramForWatching,
		reportDiagnostic,
		reportWatchStatusChanged
	);

	// To stop watching, monitor and store timers;
	// when stopping watching, reset all timers.
	const origClearTimeout = host.clearTimeout!;
	const origSetTimeout = host.setTimeout!;
	let timeoutIds: any[] = [];
	host.clearTimeout = (timeoutId) => {
		timeoutIds = timeoutIds.filter((id) => id !== timeoutId);
		origClearTimeout(timeoutId);
	};
	host.setTimeout = (callback, ms, ...args) => {
		const timeoutId = origSetTimeout(callback, ms, ...args);
		timeoutIds.push(timeoutId);
		return timeoutId;
	};

	// `createWatchProgram` creates an initial program, watches files, and updates
	// the program over time.
	ts.createWatchProgram(host);
	watchStarted = true;

	handlers && handlers.onTsCompileFinished && handlers.onTsCompileFinished(config.data);

	let startTimeOnFileChange: number | undefined;

	return {
		...config,
		compilerHost: host,
		watchInstance: {
			async stop() {
				// clear all timers to stop watching
				timeoutIds.splice(0).forEach((id) => {
					origClearTimeout(id);
				});
			}
		}
	};

	function reportDiagnostic(diagnostic: ts.Diagnostic) {
		const err = new TypeScriptError(diagnostic);
		handleError(watchStarted, handlers, err);
	}

	function reportWatchStatusChanged(diagnostic: ts.Diagnostic) {
		switch (diagnostic.code) {
			case 6032:
				startTimeOnFileChange = Date.now();
				logInfo(handlers, 'TypeScript file change detected.');
				break;
			case 6042:
				if (watchStarted) {
					logInfo(handlers, `TypeScript compilation finished. (time = ${Date.now() - startTimeOnFileChange!} ms.)`);
				}
				break;
		}
		logVerbose(handlers, new TypeScriptError(diagnostic).message, diagnostic);
	}
}

////////////////////////////////////////////////////////////////////////////////

function initializeWebpackConfiguration(
	tscBuildResult: TscBuildResult,
	conf: webpack.Configuration | null | undefined,
	watch: boolean,
	options: Options | undefined
) {
	const tempOutDir = path.resolve(tscBuildResult.data.compilerOptions.outDir!);

	const newConf: webpack.Configuration = conf || {};
	const newResolve = (newConf.resolve || (newConf.resolve = {}));
	const modules = newResolve.modules;
	if (modules) {
		const tsBasePath = getTsBasePath(tscBuildResult);
		for (let i = 0; i < modules.length; ++i) {
			const m = modules[0];
			if (path.normalize(path.resolve(m)) === tsBasePath) {
				modules.splice(i, 0, tempOutDir);
				//console.log('** ', modules);
				break;
			}
		}
	}

	// add rule for pre-compiled TypeScript files
	const ruleSetItems: webpack.RuleSetUseItem[] = [{
		loader: path.resolve(path.dirname(module.filename), './webpack/tsc2webpack-loader'),
		options: {
			tscBuildResult: tscBuildResult,
			handlers: options && options.handlers,
			emitDeclarations: options && options.emitDeclarations
		}
	}];
	const additionalLoaders = options && options.loadersForTsFiles;
	if (additionalLoaders) {
		if (additionalLoaders.head) {
			if (Array.isArray(additionalLoaders.head)) {
				ruleSetItems.unshift(...additionalLoaders.head);
			} else {
				ruleSetItems.unshift(additionalLoaders.head);
			}
		}
		if (additionalLoaders.tail) {
			if (Array.isArray(additionalLoaders.tail)) {
				ruleSetItems.push(...additionalLoaders.tail);
			} else {
				ruleSetItems.push(additionalLoaders.tail);
			}
		}
	}
	const moduleConf = (newConf.module || (newConf.module = { rules: [] }));
	moduleConf.rules = [{
		test: (input: string) => isTsProjectSourceFile(tscBuildResult, input),
		use: ruleSetItems
	} as webpack.RuleSetRule].concat(...(moduleConf.rules || []));

	if (watch) {
		// For watch mode, use internal WatchReplacePlugin to detect changes
		// js files emitted by TypeScript compiler.
		(newConf.plugins || (newConf.plugins = [])).push(
			new WatchReplacePlugin(tscBuildResult, tempOutDir)
		);
	}

	return newConf;
}

function handleWebpackError(isWatching: boolean, handlers: Handlers | undefined, error: any) {
	handleError(isWatching, handlers, error instanceof Error ? error : new WebpackError(error));
}

function handleWebpackLog(handlers: Handlers | undefined, stats: webpack.Stats) {
	if (stats.endTime) {
		logInfo(handlers, `Output from webpack:\n${stats.toString(webpackStatsOptions)}`, stats);
	}
}

function executeWebpack(
	tscBuildResult: TscBuildResult,
	conf: webpack.Configuration | null | undefined,
	options: Options | undefined
): Promise<void> {
	const config = initializeWebpackConfiguration(
		tscBuildResult,
		conf,
		false,
		options
	);
	delete config.watch;
	const compiler = webpack(config);

	const handlers = options && options.handlers;
	return new Promise<void>((resolve) => {
		compiler.run((err, stat) => {
			//console.log('**', err, stat);
			if (err) {
				handleWebpackError(false, handlers, err);
			} else if (stat.hasErrors()) {
				stat.compilation.errors.forEach((e) => handleWebpackError(false, handlers, e));
			} else {
				handleWebpackLog(handlers, stat);
			}
			resolve();
		});
	}).then(() => {
		handlers && handlers.onWebpackFinished && handlers.onWebpackFinished(tscBuildResult.data, config);
	});
}

function watchWebpack(
	tscBuildResult: TscBuildResult,
	conf: webpack.Configuration | null | undefined,
	options: Options | undefined
): Promise<WatchInstance> {
	const config = initializeWebpackConfiguration(
		tscBuildResult,
		conf,
		true,
		options
	);
	const compiler = webpack(config);

	const handlers = options && options.handlers;
	let isWatching = false;
	return new Promise<webpack.Compiler.Watching>((resolve) => {
		let lastHash: string | undefined;
		const r = compiler.watch({}, (err, stat) => {
			if (err) {
				handleWebpackError(isWatching, handlers, err);
			} else if (stat.hasErrors()) {
				stat.compilation.errors.forEach((e) => handleWebpackError(isWatching, handlers, e));
			} else {
				if (stat.hash !== lastHash) {
					lastHash = stat.hash;
					handleWebpackLog(handlers, stat);
				}
			}
		});
		resolve(r);
	}).then((watching) => {
		isWatching = true;
		handlers && handlers.onWebpackFinished && handlers.onWebpackFinished(tscBuildResult.data, config);
		return <WatchInstance>{
			stop() {
				return new Promise<void>((resolve) => {
					watching.close(resolve);
				});
			}
		}
	});
}

async function reportExecutionTime<T>(startText: string, finishText: string, handlers: Handlers | undefined, executor: () => Promise<T>): Promise<T> {
	const startTime = Date.now();
	logInfo(handlers, `${startText}`);
	try {
		return await executor();
	} finally {
		logInfo(handlers, `${finishText} (time = ${Date.now() - startTime} ms.)`);
	}
}

/**
 * Executes TypeScript compiler and webpack process.
 * @param basePath The base directory for tsconfig search path [default: './']
 * @param tsconfig The configuration file name of 'tsconfig.json' (for TypeScript compiler).
 *                 Either absolute or relative path can be specified. [default: 'tsconfig.json']
 * @param webpackConfig The configuration object for webpack [default: {}]
 * @param options Additional options for process (see Options interface)
 * @return Promise object (resolved with no value when finished)
 */
export async function execute(
	basePath?: string | null | undefined,
	tsconfig?: string | null | undefined,
	webpackConfig?: webpack.Configuration | null | undefined,
	options?: Options
): Promise<void>;
/**
 * Executes TypeScript compiler and webpack process.
 * @param basePath The base directory of webpack entry files
 * @param tsconfig The configuration object, instead of 'tsconfig.json' (for TypeScript compiler)
 * @param webpackConfig The configuration object for webpack [default: {}]
 * @param options Additional options for process (see Options interface)
 * @return Promise object (resolved with no value when finished)
 */
export async function execute(
	basePath: string,
	tsconfig: TscConfig,
	webpackConfig?: webpack.Configuration | null | undefined,
	options?: Options
): Promise<void>

export async function execute(
	basePath?: string | null | undefined,
	tsconfig?: TscConfig | string | null | undefined,
	webpackConfig?: webpack.Configuration | null | undefined,
	options?: Options
): Promise<void> {
	const locale = options && options.locale;
	const handlers = options && options.handlers;
	const config = (
		tsconfig && typeof (tsconfig) !== 'string' ?
			makeTscBuildConfigByObject(basePath!, tsconfig, options && options.tempBuildDir) :
			makeTscBuildConfigByFile(basePath, tsconfig, options && options.tempBuildDir)
	);
	await reportExecutionTime('Execute...', 'Done.', handlers, async () => {
		let tscBuildResult: TscBuildResult;
		await reportExecutionTime('Execute TypeScript compiler...', 'TypeScript compilation finished.', handlers, async () => {
			tscBuildResult = executeTsc(config, handlers, locale || void (0));
		});
		await reportExecutionTime(
			'Execute webpack...', 'webpack finished.', handlers,
			() => executeWebpack(
				tscBuildResult,
				webpackConfig,
				options
			)
		);
	});
}

/**
 * Executes and starts watching processes of TypeScript compiler and webpack process.
 * @param basePath The base directory for tsconfig search path [default: './']
 * @param tsconfig The configuration file name of 'tsconfig.json' (for TypeScript compiler).
 *                 Either absolute or relative path can be specified. [default: 'tsconfig.json']
 * @param webpackConfig The configuration object for webpack [default: {}]
 * @param options Additional options for process (see Options interface)
 * @return Promise object (resolved with the WatchInstance object when started watching)
 */
export async function watch(
	basePath?: string | null | undefined,
	tsconfig?: string | null | undefined,
	webpackConfig?: webpack.Configuration | null | undefined,
	options?: Options
): Promise<WatchInstance>;
/**
 * Executes and starts watching processes of TypeScript compiler and webpack process.
 * @param basePath The base directory for TypeScript files
 * @param tsconfig The configuration object, instead of 'tsconfig.json' (for TypeScript compiler)
 * @param webpackConfig The configuration object for webpack [default: {}]
 * @param options Additional options for process (see Options interface)
 * @return Promise object (resolved with the WatchInstance object when started watching)
 */
export async function watch(
	basePath: string,
	tsconfig: TscConfig,
	webpackConfig?: webpack.Configuration | null | undefined,
	options?: Options
): Promise<WatchInstance>

export async function watch(
	basePath?: string | null | undefined,
	tsconfig?: TscConfig | string | null | undefined,
	webpackConfig?: webpack.Configuration | null | undefined,
	options?: Options
): Promise<WatchInstance> {
	const locale = options && options.locale;
	const handlers = options && options.handlers;
	const config = (
		tsconfig && typeof (tsconfig) !== 'string' ?
			makeTscBuildConfigByObject(basePath!, tsconfig, options && options.tempBuildDir) :
			makeTscBuildConfigByFile(basePath, tsconfig, options && options.tempBuildDir)
	);
	return await reportExecutionTime('Start watching...', 'Done.', handlers, async () => {
		let tscBuildResult: TscBuildResult;
		const w1 = await reportExecutionTime('Execute TypeScript compiler...', 'TypeScript compilation finished.', handlers, async () => {
			tscBuildResult = watchTsc(config, handlers, locale || void (0));
			return tscBuildResult.watchInstance!;
		});
		const w2 = await reportExecutionTime(
			'Starting webpack...', 'webpack started.', handlers,
			() => watchWebpack(
				tscBuildResult,
				webpackConfig,
				options
			)
		);
		return {
			async stop() {
				await Promise.all([w1.stop(), w2.stop()]);
			}
		};
	});
}

export function getWebpackStatsOptions() {
	return webpackStatsOptions;
}

/**
 * Overwrites the options for webpack logging (passed to toString method of Stats).
 */
export function setWebpackStatsOptions(options: webpack.Stats.ToStringOptionsObject) {
	Object.assign(webpackStatsOptions, options);
}

/** A prototype of 'webpack' function */
export interface WebpackFunction {
	(options: webpack.Configuration): webpack.Compiler;
	(options: webpack.Configuration, handler: webpack.Compiler.Handler): webpack.Compiler;
	(options: webpack.Configuration[]): webpack.MultiCompiler;
	(options: webpack.Configuration[], handler: webpack.MultiCompiler.Handler): webpack.MultiCompiler;
}

/**
 * Creates wrapped 'webpack' function, calling TypeScript compiler before real webpack process.
 * @param basePath The base directory for tsconfig search path.
 *                 This directory also be used for the base directory of
 *                 webpack entry files. [default: './']
 * @param tsconfig The configuration file name of 'tsconfig.json' (for TypeScript compiler).
 *                 Either absolute or relative path can be specified. [default: 'tsconfig.json']
 * @param options Additional options for process (see Options interface)
 * @return wrapped 'webpack' function
 */
export function createWebpackFunction(
	basePath?: string | null | undefined,
	tsconfig?: string | null | undefined,
	options?: Options
): WebpackFunction;
/**
 * Creates wrapped 'webpack' function, calling TypeScript compiler before real webpack process.
 * @param basePath The base directory for TypeScript files
 * @param tsconfig The configuration object, instead of 'tsconfig.json' (for TypeScript compiler)
 * @param options Additional options for process (see Options interface)
 * @return wrapped 'webpack' function
 */
export function createWebpackFunction(
	basePath: string,
	tsconfig: TscConfig,
	options?: Options
): WebpackFunction;

export function createWebpackFunction(
	basePath?: string | null | undefined,
	tsconfig?: TscConfig | string | null | undefined,
	options?: Options
): WebpackFunction {
	const locale = options && options.locale;
	const handlers = options && options.handlers;
	const config = (
		tsconfig && typeof (tsconfig) !== 'string' ?
			makeTscBuildConfigByObject(basePath!, tsconfig, options && options.tempBuildDir) :
			makeTscBuildConfigByFile(basePath, tsconfig, options && options.tempBuildDir)
	);

	function wrappedWebpack(options: webpack.Configuration): webpack.Compiler;
	function wrappedWebpack(options: webpack.Configuration, handler: webpack.Compiler.Handler): webpack.Compiler;
	function wrappedWebpack(options: webpack.Configuration[]): webpack.MultiCompiler;
	function wrappedWebpack(options: webpack.Configuration[], handler: webpack.MultiCompiler.Handler): webpack.MultiCompiler;

	function wrappedWebpack(
		conf: webpack.Configuration | webpack.Configuration[],
		handler?: webpack.Compiler.Handler | webpack.MultiCompiler.Handler
	) {
		const watchMode = (conf instanceof Array ? conf.some((o) => !!o.watch) : !!conf.watch);

		let tscBuildResult: TscBuildResult;
		if (watchMode) {
			tscBuildResult = watchTsc(config, handlers, locale || void (0));
		} else {
			tscBuildResult = executeTsc(config, handlers, locale || void (0));
		}

		if (conf instanceof Array) {
			const newConf = conf.map((c) => initializeWebpackConfiguration(
				tscBuildResult,
				c,
				watchMode,
				options
			));
			if (handler) {
				return webpack(newConf, handler as webpack.MultiCompiler.Handler);
			} else {
				return webpack(newConf);
			}
		} else {
			const newConf = initializeWebpackConfiguration(
				tscBuildResult,
				conf,
				watchMode,
				options
			);
			if (handler) {
				return webpack(newConf, handler as webpack.Compiler.Handler);
			} else {
				return webpack(newConf);
			}
		}
	}

	return wrappedWebpack;
}
