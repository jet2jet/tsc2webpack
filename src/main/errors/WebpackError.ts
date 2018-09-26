
/**
 * An error object raised during webpack process.
 * The 'message' field is set with `${detail}`.
 */
export default class WebpackError extends Error {
	/** A detail object for the error (Error object or something other object) */
	public detail: any;

	constructor(detail: any) {
		super(`${detail}`);
		this.detail = detail;
	}
}
