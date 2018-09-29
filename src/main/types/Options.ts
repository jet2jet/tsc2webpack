
import * as webpack from 'webpack';

import Handlers from './Handlers';

/**
 * Additional options for executions or watchings
 */
export default interface Options {
	/**
	 * Temporal output directory for emitted JS files from TypeScript compiler.
	 * If specified, this overrides 'outDir' compiler option
	 * (tempBuildDir will be the value of 'outDir').
	 */
	tempBuildDir?: string | undefined;
	/** The locale/language for TypeScript messages [default: (unspecified)] */
	locale?: string | undefined;
	/**
	 * An object containing handlers for events and loggings. [default: (none)]
	 * To output logs, handlers must be specified.
	 */
	handlers?: Handlers;
	/**
	 * Enables to emit declaration files as assets of webpack.
	 * Use this flag if some plugins, specified in the webpack configuration, gather declaration files.
	 *
	 * NOTE: No declaration files will be emitted unless 'declaration' flag in the tsconfig.json is true.
	 */
	emitDeclarations?: boolean;
	/**
	 * Additional webpack loaders for TypeScript files.
	 * Loaders in 'head' will be added into 'use' array *before* tsc2webpack's internal loader, and
	 * loaders in 'tail' will be added *after* the internal loader.
	 *
	 * NOTE: In webpack, loaders in 'use' array are applied in reverse order (from tail to head).
	 */
	loadersForTsFiles?: {
		head?: webpack.RuleSetUseItem | webpack.RuleSetUseItem[];
		tail?: webpack.RuleSetUseItem | webpack.RuleSetUseItem[];
	};
}
