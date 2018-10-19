
import * as webpack from 'webpack';

import WatchFileSystemWatchCallback from './WatchFileSystemWatchCallback';

/** @internal */
export interface WatchManager {
	close(): void;
	pause(): void;
	getFileTimestamps(): Map<string, number>;
	getContextTimestamps(): Map<string, number>;
}

/** @internal */
export default interface WatchFileSystem {
	watch(
		files: string[],
		dirs: string[],
		missing: string[],
		startTime: number,
		options: webpack.ICompiler.WatchOptions,
		callback: WatchFileSystemWatchCallback,
		callbackUndelayed?: (file: string, mtime: number) => void
	): WatchManager;
}
