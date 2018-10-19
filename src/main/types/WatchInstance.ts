
/**
 * An object for watching processes
 */
export default interface WatchInstance {
	/**
	 * Stops all watching processes asynchronously.
	 * @return Promise object (resolved when all watching processes are stopped)
	 */
	stop(): Promise<void>;
	/**
	 * Updates TypeScript file list when using TscConfig object for compilation.
	 * Ignored when 'tsconfig.json' file is used.
	 * @param files new file list to compile
	 */
	updateTsFiles(files: ReadonlyArray<string>): void;
}
