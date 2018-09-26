
import * as ts from 'typescript';

import TscBuildConfig from './TscBuildConfig';
import WatchInstance from './WatchInstance';

/** @internal */
export default interface TscBuildResult extends TscBuildConfig {
	compilerHost: ts.CompilerHost | ts.WatchCompilerHost<ts.SemanticDiagnosticsBuilderProgram>;
	watchInstance?: WatchInstance;
}
