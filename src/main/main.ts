#!/usr/bin/env node

/// <reference types='node' />

import * as path from 'path';

import * as webpack from 'webpack';
import * as yargs from 'yargs';

import thisVersion from './version';

import { execute, watch } from './execute';
import TypeScriptError from './errors/TypeScriptError';
import WebpackError from './errors/WebpackError';
import Constants from './types/Constants';
import Handlers from './types/Handlers';

interface Arguments extends yargs.Arguments {
	tsconfig?: string;
	webpackConfig?: string;
	tempBuildDir?: string;
	emitDeclarations?: boolean;
	lang?: string;
	watch?: boolean;
	verbose?: boolean;
	version?: boolean;
}

const thisNameHeader = `[${Constants.ThisName}] `;

class ConsoleHandlers implements Handlers {
	public verbose: boolean = false;

	public handleError(isWatching: boolean, message: string, error: Error) {
		if (!isWatching) {
			throw error;
		}
		console.error(`${thisNameHeader}${message}`);
	}
	public logInfo(message: string, _details?: any) {
		console.info(`${thisNameHeader}${message}`);
	}
	public logVerbose(message: string, _details?: any) {
		if (this.verbose) {
			console.log(`${thisNameHeader}${message}`);
		}
	}
}

async function execCompiler(argv: Arguments) {
	const handlers = new ConsoleHandlers();
	handlers.verbose = !!argv.verbose;
	let webpackBasePath: string;
	let webpackConfig: webpack.Configuration | undefined;

	const wp = path.resolve(argv.webpackConfig || 'webpack.config.js');
	webpackConfig = await import(wp) as webpack.Configuration;
	webpackBasePath = path.dirname(wp);

	if (argv.watch) {
		const watchInstance = await watch(
			webpackBasePath,
			argv.tsconfig,
			webpackConfig,
			{
				tempBuildDir: argv.tempBuildDir,
				locale: argv.lang,
				emitDeclarations: argv.emitDeclarations,
				handlers
			}
		);
		console.log(`${thisNameHeader}Now watching...(Ctrl+C to exit)`);
		return new Promise<void>((resolve, reject) => {
			process.on('SIGINT', () => {
				console.log(`${thisNameHeader}Exit.`);
				watchInstance.stop().then(resolve, reject);
			});
		});
	} else {
		await execute(
			webpackBasePath,
			argv.tsconfig,
			webpackConfig,
			{
				tempBuildDir: argv.tempBuildDir,
				locale: argv.lang,
				emitDeclarations: argv.emitDeclarations,
				handlers
			}
		);
	}
}

async function main() {
	try {
		const argv = yargs
			.usage(`Usage:
  ${Constants.ThisName} [-p <tsconfig.json>] [-c <webpack.config.js>] [<options...>]

  * If tsconfig.json is omitted, ${Constants.ThisName} searches 'tsconfig.json'
    from the current directory (using TypeScript's search procedure).
  * If webpack.config.js is omitted, ${Constants.ThisName} loads 'webpack.config.js'
    with the expression 'require(path.resolve("webpack.config.js"))'.`)
			.option('tsconfig', {
				alias: ['p', 'project'],
				type: 'string',
				description: 'The project file or directory for TypeScript tsconfig.json'
			})
			.option('webpackConfig', {
				alias: ['c', 'conf'],
				type: 'string',
				description: 'The webpack configuration JavaScript file (usually webpack.config.js)'
			})
			.option('watch', {
				alias: ['w'],
				type: 'boolean',
				description: 'Start watch processes when build finished'
			})
			.option('tempBuildDir', {
				alias: ['tempDir'],
				type: 'string',
				description: 'Temporal output directory for emitted JS files from TypeScript compiler'
			})
			.option('emitDeclarations', {
				alias: ['d'],
				type: 'boolean',
				description: 'Enables to emit declaration files as assets of webpack'
			})
			.option('lang', {
				alias: ['locale'],
				type: 'string',
				description: 'The locale/language for TypeScript messages'
			})
			.option('verbose', {
				alias: ['v'],
				type: 'boolean',
				description: 'Enables verbose logging mode'
			})
			.version(false)
			.option('version', {
				alias: ['V'],
				type: 'boolean',
				description: 'Show version number and exit'
			})
			.option('help', {
				alias: ['h', '?'],
				type: 'boolean',
				description: 'Show help and exit'
			})
			//.help()
			.argv as Arguments;

		if (argv.version) {
			console.log(`${Constants.ThisName} version ${thisVersion}`);
			return 0;
		}

		await execCompiler(argv);
	} catch (s) {
		if (s instanceof Error) {
			if (s instanceof TypeScriptError || s instanceof WebpackError) {
				console.error(`${thisNameHeader}${s.message}`);
			} else {
				console.error(`${thisNameHeader}Error:`, s);
			}
		} else {
			if (typeof s !== 'string') {
				s = s.toString();
			}
			if (s) {
				console.error(`${thisNameHeader}Error: ${s}`);
			}
		}
		return 1;
	}
	return 0;
}
(async () => {
	process.exit(await main());
})();
