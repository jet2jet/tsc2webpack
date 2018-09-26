
import * as ts from 'typescript';

export default interface TscConfig {
	compilerOptions: ts.CompilerOptions;
	files: string[];
}
