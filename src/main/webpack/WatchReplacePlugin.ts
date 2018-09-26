
import * as webpack from 'webpack';

import TscBuildResult from '../types/TscBuildResult';

import {
	convertJsFileNameToTs,
	convertTsFileNameToJs,
	isChildPath,
	isTsProjectSourceFile
} from '../utils/functions';

interface WatchFileSystemWatchCallback {
	(
		err: Error | null | undefined,
		filesModified?: string[],
		dirsModified?: string[],
		missingModified?: string[],
		fileTimestamps?: Map<string, number>,
		dirTimestamps?: Map<string, number>
	): void;
}

interface WatchFileSystem {
	watch(
		files: string[],
		dirs: string[],
		missing: string[],
		startTime: number,
		options: any,
		callback: WatchFileSystemWatchCallback,
		callbackUndelayed?: (file: string, mtime: number) => void
	): {
		close(): void;
		pause(): void;
		getFileTimestamps(): Map<string, number>;
		getContextTimestamps(): Map<string, number>;
	};
}

class ReplaceWatchFileSystem implements WatchFileSystem {
	constructor(
		private wfs: WatchFileSystem,
		private tscBuildResult: TscBuildResult,
		private tempOutDir: string
	) {
		//
	}

	public watch(
		files: string[],
		dirs: string[],
		missing: string[],
		startTime: number,
		options: any,
		callback: WatchFileSystemWatchCallback,
		callbackUndelayed?: (file: string, mtime: number) => void
	) {
		return this.wfs.watch(
			files.map((file) => {
				// convert .ts files to .js
				return isTsProjectSourceFile(this.tscBuildResult, file) ?
					convertTsFileNameToJs(this.tscBuildResult, file) :
					file;
			}),
			dirs,
			missing,
			startTime,
			options,
			(err, filesModified, dirsModified, missingModified, fileTimestamps, dirTimestamps) => {
				callback(
					err,
					filesModified && filesModified.map((file) => {
						if (!isChildPath(this.tempOutDir, file)) {
							return file;
						}
						// back to .ts files
						const timestamp = fileTimestamps!.get(file);
						const tsFile = convertJsFileNameToTs(this.tscBuildResult, this.tempOutDir, file);
						if (typeof timestamp !== 'undefined') {
							// re-set timestamp map
							fileTimestamps!.delete(file);
							fileTimestamps!.set(tsFile, timestamp);
						}
						return tsFile;
					}),
					dirsModified,
					missingModified,
					fileTimestamps,
					dirTimestamps
				);
			},
			callbackUndelayed
		);
	}
}

/**
 * An internal plugin for watching .ts(x) files (rewrites to .js files)
 * @internal
 */
export default class WatchReplacePlugin {
	constructor(
		private tscBuildResult: TscBuildResult,
		private tempOutDir: string
	) {
		//
	}

	public apply(compiler: webpack.Compiler) {
		const process = () => {
			(compiler as any).watchFileSystem = new ReplaceWatchFileSystem(
				(compiler as any).watchFileSystem,
				this.tscBuildResult,
				this.tempOutDir
			);
		};
		if (compiler.hooks) {
			compiler.hooks.afterEnvironment.tap('WatchReplacePlugin', process);
		} else {
			compiler.plugin('after-environment', process);
		}
	}
}
