
import * as webpack from 'webpack';

/**
 * A plugin to specify additional webpack loaders to apply for TypeScript files
 * before/after tsc2webpack's internal loader.
 *
 * NOTE: In webpack, loaders in 'use' array are applied in reverse order (from tail to head).
 */
export default class AdditionalLoadersPlugin {
	/** @internal */
	public head: webpack.RuleSetUseItem | webpack.RuleSetUseItem[] | null | undefined;
	/** @internal */
	public tail: webpack.RuleSetUseItem | webpack.RuleSetUseItem[] | null | undefined;

	/**
	 * A constructor of the plugin.
	 * @param head 'use' item(s) to be added into 'use' array *before* tsc2webpack's internal loader
	 * @param tail 'use' item(s) to be added into 'use' array *after* tsc2webpack's internal loader
	 */
	constructor(
		head?: webpack.RuleSetUseItem | webpack.RuleSetUseItem[] | null | undefined,
		tail?: webpack.RuleSetUseItem | webpack.RuleSetUseItem[] | null | undefined
	) {
		this.head = head;
		this.tail = tail;
	}

	public apply(_compiler: webpack.Compiler) {
		throw new Error('This plugin must be used with tsc2webpack (via \'tsc2webpack\' command line or API)');
	}
}
