
import * as ts from 'typescript';

const formatHost: ts.FormatDiagnosticsHost = {
	getCanonicalFileName: (path) => path,
	getCurrentDirectory: ts.sys.getCurrentDirectory,
	getNewLine: () => ts.sys.newLine
};

function isReadonlyArray(value: any): value is ReadonlyArray<any> {
	return 'slice' in value && 'forEach' in value;
}

/*
`Error ${diagnostic.code}: ${ts.flattenDiagnosticMessageText(
	diagnostic.messageText,
	formatHost.getNewLine()
)}`
*/

/**
 * An error object raised during TypeScript compilation.
 * The 'message' field is set with the formatted message from diagnostics.
 */
export default class TypeScriptError extends Error {
	/** An array of diagnostic objects referring errors. */
	public diagnostics: ReadonlyArray<ts.Diagnostic>;

	constructor(diagnostic: ts.Diagnostic);
	constructor(diagnostics: ReadonlyArray<ts.Diagnostic>);

	constructor(diagnostic: ts.Diagnostic | ReadonlyArray<ts.Diagnostic>) {
		if (isReadonlyArray(diagnostic)) {
			super(ts.formatDiagnostics(diagnostic, formatHost).replace(/[\r\n]+$/g, ''));
			this.diagnostics = diagnostic;
		} else {
			super(ts.formatDiagnostic(diagnostic, formatHost).replace(/[\r\n]+$/g, ''));
			this.diagnostics = [diagnostic];
		}
	}
}
