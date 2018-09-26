
import * as path from 'path';

import TscBuildResult from '../types/TscBuildResult'

/** @internal */
export function isTsProjectSourceFile(tscBuildResult: TscBuildResult, fileName: string): boolean {
	return tscBuildResult.data.files.some((file) => path.normalize(file) === fileName);
}

/** @internal */
export function isChildPath(basePath: string, targetPath: string): boolean {
	const p = path.relative(basePath, targetPath).split(path.sep);
	return p.indexOf('..') < 0;
}

/** @internal */
export function getTsBasePath(tscBuildResult: TscBuildResult) {
	return path.resolve(tscBuildResult.data.compilerOptions.baseUrl || tscBuildResult.configDirectory);
}

/** @internal */
export function getFullSourceFileName(tscBuildResult: TscBuildResult, pathName: string) {
	return path.resolve(getTsBasePath(tscBuildResult), pathName);
}

/** @internal */
export function convertTsFileNameToJs(tscBuildResult: TscBuildResult, tsFileName: string): string {
	const relativeNameData = path.parse(
		path.relative(getTsBasePath(tscBuildResult), tsFileName)
	);
	delete relativeNameData.base;
	relativeNameData.ext = '.js';
	return path.join(path.resolve(tscBuildResult.data.compilerOptions.outDir!), path.format(relativeNameData));
}

/** @internal */
export function convertJsFileNameToTs(tscBuildResult: TscBuildResult, tempOutDir: string, jsFileName: string): string {
	const relativeNameData = path.parse(
		path.relative(tempOutDir, jsFileName)
	);
	delete relativeNameData.base;
	relativeNameData.ext = '.ts';
	let s = path.normalize(path.join(getTsBasePath(tscBuildResult), path.format(relativeNameData)));
	for (const file of tscBuildResult.data.files) {
		if (/\.tsx$/.test(file) && file.startsWith(s)) {
			s = file;
			break;
		}
	}
	return s;
}
