
import * as fs from 'fs';
import * as path from 'path';

import { getOptions } from 'loader-utils';
import * as webpack from 'webpack';

import Handlers from '../types/Handlers';
import TscBuildResult from '../types/TscBuildResult';

import {
	convertTsFileNameToJs, getTsBasePath, isTsProjectSourceFile
} from '../utils/functions';
import { logInfo } from '../utils/log';

/**
 * An internal loader for loading .ts(x) files as .js files
 * @internal
 */
export default function tsc2webpackLoader(this: webpack.loader.LoaderContext, input: any, inputMap: any) {
	this.cacheable && this.cacheable();

	const options = getOptions(this);
	const handlers: Handlers | undefined = options.handlers;
	const tscBuildResult: TscBuildResult = options.tscBuildResult;
	const emitDeclarations: boolean | undefined = options.emitDeclarations;
	const sourceFileName = path.normalize(this.resourcePath);

	const callback = this.async();
	if (!callback) {
		return input;
	}

	// ignore non-project files
	if (!isTsProjectSourceFile(tscBuildResult, sourceFileName)) {
		callback(null, input, inputMap);
		return;
	}

	if (this._compiler && emitDeclarations && tscBuildResult.data.compilerOptions.declaration) {
		const onAfterCompile = (compilation: webpack.compilation.Compilation) => {
			if (!(compilation.compiler as any).isChild()) {
				// emit declaration files for webpack
				emitDeclarationFile(compilation, tscBuildResult);
			}
		};
		if (this._compiler.hooks) {
			this._compiler.hooks.afterCompile.tap('tsc-webpack-loader', onAfterCompile);
		} else {
			this._compiler.plugin('after-compile', onAfterCompile);
		}
	}

	const jsFileName = convertTsFileNameToJs(tscBuildResult, sourceFileName);
	fs.readFile(jsFileName, 'utf8', (err, jsSource) => {
		if (err) {
			callback(err);
		} else {
			// if source-map is emitted, use it
			if (jsSource && tscBuildResult.data.compilerOptions.sourceMap) {
				fs.readFile(jsFileName + '.map', 'utf8', (err2, mapSource) => {
					if (err2) {
						logInfo(handlers, err2.message, err2);
						callback(null, jsSource);
					} else {
						try {
							callback(null, jsSource, JSON.parse(mapSource));
						} catch (e) {
							logInfo(handlers, e && e.message || `${e}`, e);
							callback(null, jsSource);
						}
					}
				});
			} else {
				callback(null, jsSource);
			}
		}
	});
}

function getWebpackOutputPath(compiler: webpack.Compiler) {
	const conf = compiler.options || {};
	return ((compiler as any).outputPath as (string | undefined)) || (conf.output && conf.output.path);
}

function emitDeclarationFile(
	compilation: webpack.compilation.Compilation,
	tscBuildResult: TscBuildResult
) {
	const outputPath = getWebpackOutputPath(compilation.compiler) || './';
	//console.info('** Start emit declarations');
	tscBuildResult.data.files.forEach((tsFile) => {
		// generate original .d.ts file
		const basePath = getTsBasePath(tscBuildResult);
		const pathObject = path.parse(path.relative(basePath, tsFile));
		delete pathObject.base;
		pathObject.name += '.d';
		const dtsFile = path.resolve(
			basePath,
			tscBuildResult.data.compilerOptions.declarationDir || tscBuildResult.data.compilerOptions.outDir!,
			path.format(pathObject)
		);
		// asset name should be relative path from outputPath
		const assetName = path.relative(outputPath, dtsFile);
		//console.info(dtsFile);
		if (compilation.assets[assetName]) {
			return;
		}
		try {
			const content = fs.readFileSync(dtsFile, 'utf8');
			compilation.assets[assetName] = {
				source: () => content,
				size: () => content.length
			};
		} catch (_e) {
			// do nothing
		}
	});
}
