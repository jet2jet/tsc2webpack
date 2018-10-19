
/** @internal */
export default interface WatchFileSystemWatchCallback {
	(
		err: Error | null | undefined,
		filesModified?: string[],
		dirsModified?: string[],
		missingModified?: string[],
		fileTimestamps?: Map<string, number>,
		dirTimestamps?: Map<string, number>
	): void;
}
