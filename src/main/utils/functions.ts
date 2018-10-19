
import * as path from 'path';

import TscBuildConfig from '../types/TscBuildConfig'

/** @internal */
export function isTsProjectSourceFile(tscBuildConfig: TscBuildConfig, fileName: string): boolean {
	return tscBuildConfig.data.files.some((file) => path.normalize(file) === fileName);
}

/** @internal */
export function isChildPath(basePath: string, targetPath: string): boolean {
	const p = path.relative(basePath, targetPath).split(path.sep);
	return p.indexOf('..') < 0;
}

/** @internal */
export function getTsBasePath(tscBuildConfig: TscBuildConfig) {
	return path.resolve(tscBuildConfig.data.compilerOptions.baseUrl || tscBuildConfig.configDirectory);
}

/** @internal */
export function getFullSourceFileName(tscBuildConfig: TscBuildConfig, pathName: string) {
	return path.resolve(getTsBasePath(tscBuildConfig), pathName);
}

/** @internal */
export function convertTsFileNameToJs(tscBuildConfig: TscBuildConfig, tsFileName: string): string {
	const relativeNameData = path.parse(
		path.relative(getTsBasePath(tscBuildConfig), tsFileName)
	);
	delete relativeNameData.base;
	relativeNameData.ext = '.js';
	const wrappedFs = tscBuildConfig.wrappedFs;
	if (wrappedFs) {
		return wrappedFs.resolvePath(wrappedFs.joinPath(
			tscBuildConfig.data.compilerOptions.outDir!,
			path.format(relativeNameData)
		));
	} else {
		return path.join(tscBuildConfig.data.compilerOptions.outDir!, path.format(relativeNameData));
	}
}

/** @internal */
export function convertJsFileNameToTs(tscBuildConfig: TscBuildConfig, tempOutDir: string, jsFileName: string): string {
	const relativeNameData = path.parse(
		tscBuildConfig.wrappedFs
			? tscBuildConfig.wrappedFs.relativePath(tempOutDir, jsFileName)
			: path.relative(tempOutDir, jsFileName)
	);
	delete relativeNameData.base;
	relativeNameData.ext = '.ts';
	let s = path.normalize(path.join(getTsBasePath(tscBuildConfig), path.format(relativeNameData)));
	for (const file of tscBuildConfig.data.files) {
		if (/\.tsx$/.test(file) && file.startsWith(s)) {
			s = file;
			break;
		}
	}
	return s;
}
