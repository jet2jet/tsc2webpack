
/**
 * An object for watching processes
 */
export default interface WatchInstance {
	/**
	 * Stops all watching processes asynchronously.
	 * @return Promise object (resolved when all watching processes are stopped)
	 */
	stop(): Promise<void>;
}
