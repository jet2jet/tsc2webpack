
import Handlers from '../types/Handlers';

/** @internal */
export function handleError(isWatching: boolean, handlers: Handlers | undefined, error: Error) {
	if (handlers && handlers.handleError) {
		handlers.handleError(isWatching, `${error.message}`, error);
	} else {
		throw error;
	}
}

/** @internal */
export function logInfo(handlers: Handlers | undefined, message: string, details?: any) {
	handlers && handlers.logInfo && handlers.logInfo(`${message}`, details);
}

/** @internal */
export function logVerbose(handlers: Handlers | undefined, message: string, details?: any) {
	handlers && handlers.verbose && handlers.logVerbose && handlers.logVerbose(`${message}`, details);
}
