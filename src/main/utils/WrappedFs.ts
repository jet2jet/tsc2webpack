
import * as nodePath from 'path';

import * as ts from 'typescript';
import * as webpack from 'webpack';
import MemoryFileSystem = require('memory-fs');

import {
	convertTsFileNameToJs,
	isChildPath,
	isTsProjectSourceFile
} from './functions';

import TscBuildConfig from '../types/TscBuildConfig';

import WatchFileSystem, { WatchManager } from '../webpack/WatchFileSystem';
import WatchFileSystemWatchCallback from '../webpack/WatchFileSystemWatchCallback';

const rootPath = 'tsw:/';
const rootPathLength = rootPath.length;
const byteOrderMarkIndicator = '\uFEFF';

interface StatData {
	/** Indicates whether this is the directory */
	['']?: boolean;
	ctime: Date;
	mtime: Date;
}
interface StatFileData extends StatData {
	['']?: false;
}
interface StatDirBaseData extends StatData {
	['']: true;
}
type StatDirData = StatDirBaseData & {
	[path: string]: any;
};
type StatItemData = StatFileData | StatDirData;
type StatMetaData = StatDirData;

function parseWrappedFsPath(pathName: string): string | null {
	return (pathName.substring(0, rootPathLength) === rootPath)
		? pathName.substring(rootPathLength - 1)
		: null;
}

function makeWrappedFsPath(pathName: string): string {
	if (pathName[0] === '/') {
		pathName = pathName.substring(1);
	}
	return rootPath + pathName;
}

function normalizeWrappedFsPath(memFs: MemoryFileSystem, pathName: string) {
	return memFs.normalize(pathName.replace(/\\/g, '/'));
}

function isStatDataFile(m: StatItemData): m is StatFileData {
	return !m[''];
}

function getStatMeta(statMeta: StatMetaData, pathArray: string[]): StatData | undefined {
	let m: StatItemData = statMeta;
	for (const p of pathArray) {
		if (isStatDataFile(m) || !m[p]) {
			return void(0);
		}
		m = m[p];
	}
	// console.log('** getStatMeta: path = ', pathArray.join('/'));
	return m;
}

function updateStatMeta(statMeta: StatMetaData, pathArray: string[], watchers: WrappedFsWatcher[]) {
	let m: StatItemData = statMeta;
	let lastCreated = false;
	const now = new Date();
	for (const p of pathArray) {
		if (isStatDataFile(m)) {
			return;
		}
		if (!m[p]) {
			m[p] = {
				['']: true,
				ctime: now,
				mtime: now
			};
			lastCreated = true;
		}
		m = m[p];
	}
	// console.log('** updateStatMeta: now = ', now, ', path = ', pathArray.join('/'));
	m.ctime = now;
	m.mtime = now;
	if (watchers.length) {
		const name = '/' + pathArray.join('/');
		watchers.forEach((watcher) => {
			if (lastCreated) {
				watcher.onFileAdded(name, now.getTime());
			} else {
				watcher.onFileChanged(name, now.getTime());
			}
		});
	}
}

function removeStatMeta(statMeta: StatMetaData, pathArray: string[], watchers: WrappedFsWatcher[]) {
	let m: StatItemData = statMeta;
	const count = pathArray.length;
	for (let i = 0; i < count; ++i) {
		const p = pathArray[i];
		if (isStatDataFile(m) || !m[p]) {
			return;
		}
		if (i === count - 1) {
			delete m[p];
			// console.log('** removeStatMeta: path = ', pathArray.join('/'));
	
			if (watchers.length) {
				watchers.forEach((watcher) => {
					const name = '/' + pathArray.join('/');
					watcher.onFileRemoved(name);
				});
			}
			return;
		}
		m = m[p];
	}
}

////////////////////////////////////////////////////////////////////////////////

/** Watcher instance watching file changes for memory-fs */
class WrappedFsWatcher implements WatchManager {
	private baseWatchManager: WatchManager | null;

	private files: string[];
	private dirs: string[];
	private missing: string[];
	private aggregateTimeout: number;
	private aggregateTimer: any;
	private filesChanged: string[];

	constructor(
		private wrappedFs: WrappedFs,
		baseWatchFileSystem: WatchFileSystem,
		files: string[],
		dirs: string[],
		missing: string[],
		startTime: number,
		options: webpack.ICompiler.WatchOptions,
		private callback: WatchFileSystemWatchCallback,
		private callbackUndelayed?: (file: string, mtime: number) => void
	) {
		this.aggregateTimeout = (options && options.aggregateTimeout) || 0;
		this.aggregateTimer = void (0);
		this.filesChanged = [];

		const memFiles: string[] = [];
		const memDirs: string[] = [];
		const memMissing: string[] = [];
		const origFiles: string[] = [];
		const origDirs: string[] = [];
		const origMissing: string[] = [];
		files.forEach((file) => {
			const p = parseWrappedFsPath(file);
			if (p === null) {
				origFiles.push(file);
			} else {
				memFiles.push(file);
			}
		});
		dirs.forEach((dir) => {
			const p = parseWrappedFsPath(dir);
			if (p === null) {
				origDirs.push(dir);
			} else {
				memDirs.push(dir);
			}
		});
		missing.forEach((m) => {
			const p = parseWrappedFsPath(m);
			if (p === null) {
				origMissing.push(m);
			} else {
				memMissing.push(m);
			}
		});

		this.files = memFiles;
		this.dirs = memDirs;
		this.missing = memMissing;

		// console.log('*** WrappedFs: watching... :', files, '; ', dirs, '; ', missing);
		this.baseWatchManager = baseWatchFileSystem.watch(
			origFiles,
			origDirs,
			origMissing,
			startTime,
			options,
			this.watchCallback.bind(this),
			callbackUndelayed
		);
		this.checkStartTime(startTime);
	}

	public close() {
		// console.log('*** WrappedFs: close watching');
		if (this.baseWatchManager) {
			this.baseWatchManager.close();
			this.baseWatchManager = null;
		}
		const i = this.wrappedFs.watchers.indexOf(this);
		if (i >= 0) {
			this.wrappedFs.watchers.splice(i, 1);
		}
	}
	public pause() {
		if (this.baseWatchManager) {
			this.baseWatchManager.pause();
			this.baseWatchManager = null;
		}
	}
	public getFileTimestamps(): Map<string, number> {
		let r = this.files.concat(this.dirs).map((name): [string, number] => {
			const p = parseWrappedFsPath(name);
			const stat = getStatMeta(this.wrappedFs.statMeta, this.wrappedFs.fs.pathToArray(p!));
			return [name, stat && stat.mtime.getTime() || 0];
		});
		if (this.baseWatchManager) {
			for (const e of this.baseWatchManager.getFileTimestamps().entries()) {
				r.push(e);
			}
		}
		return new Map<string, number>(r);
	}
	public getContextTimestamps(): Map<string, number> {
		let r = this.files.concat(this.dirs).map((name): [string, number] => {
			const p = parseWrappedFsPath(name);
			const stat = getStatMeta(this.wrappedFs.statMeta, this.wrappedFs.fs.pathToArray(p!));
			return [name, stat && stat.mtime.getTime() || 0];
		});
		if (this.baseWatchManager) {
			for (const e of this.baseWatchManager.getContextTimestamps().entries()) {
				r.push(e);
			}
		}
		return new Map<string, number>(r);
	}

	private checkStartTime(startTime: number) {
		const r = this.files.concat(this.dirs).map((name): [string, number] => {
			const p = parseWrappedFsPath(name);
			const stat = getStatMeta(this.wrappedFs.statMeta, this.wrappedFs.fs.pathToArray(p!));
			return [p!, stat && stat.mtime.getTime() || 0];
		}).filter((entry) => entry[1] >= startTime);
		if (r.length > 0) {
			// console.log('*** WrappedFs: already changed files are detected:', r);
			r.forEach((entry) => this.onFileChanged(entry[0], entry[1]));
		}
	}

	private watchCallback(
		err: Error | null | undefined,
		filesModified?: string[],
		dirsModified?: string[],
		missingModified?: string[],
		_fileTimestamps?: Map<string, number>,
		_dirTimestamps?: Map<string, number>
	) {
		// console.log('*** WrappedFs: watchCallback', filesModified, this.filesChanged);
		if (typeof this.aggregateTimer !== 'undefined') {
			(this.wrappedFs.baseSys.clearTimeout || clearTimeout)(this.aggregateTimer);
			this.aggregateTimer = void (0);
		}
		const filesChanged = this.filesChanged.splice(0);

		filesModified = (filesModified || []).concat(
			filesChanged.filter((file) => this.files.indexOf(file) >= 0)
		);
		dirsModified = (dirsModified || []).concat(
			filesChanged.filter((file) => this.dirs.indexOf(file) >= 0)
		);
		missingModified = (missingModified || []).concat(
			filesChanged.filter((file) => this.missing.indexOf(file) >= 0)
		);
		(this.callback)(
			err,
			filesModified,
			dirsModified,
			missingModified,
			this.getFileTimestamps(),
			this.getContextTimestamps()
		);
		this.close();
	}

	private _addAggregateChanges(wrappedName: string) {
		if (typeof this.aggregateTimer === 'undefined') {
			// because of unable to handle file removal with original watch manager,
			// pause watching of original watch manager
			if (this.baseWatchManager) {
				this.baseWatchManager.pause();
			}
			this.aggregateTimer = (this.wrappedFs.baseSys.setTimeout || setTimeout)(() => {
				// console.log('*** WrappedFs: aggregated', this.filesChanged);
				this.aggregateTimer = void (0);
				this.watchCallback(null, [], [], []);
			}, this.aggregateTimeout);
		}
		this.filesChanged.push(wrappedName);
	}

	public onFileAdded(name: string, mtime: number) {
		const wrappedName = makeWrappedFsPath(name);
		// console.log('*** onFileAdded', wrappedName);
		if (this.callbackUndelayed) {
			this.callbackUndelayed(wrappedName, mtime);
		}
		this._addAggregateChanges(wrappedName);
	}
	public onFileChanged(name: string, mtime: number) {
		const wrappedName = makeWrappedFsPath(name);
		// console.log('*** onFileChanged', wrappedName);
		if (this.callbackUndelayed) {
			this.callbackUndelayed(wrappedName, mtime);
		}
		this._addAggregateChanges(wrappedName);
	}
	public onFileRemoved(name: string) {
		// console.log('*** onFileRemoved', makeWrappedFsPath(name));
		this._addAggregateChanges(makeWrappedFsPath(name));
	}
}

////////////////////////////////////////////////////////////////////////////////

/**
 * Implements ts.System with memory-fs.
 * File name with special prefix (WrappedFs.ROOT_PATH) will refer to the data in memory-fs.
 * Also generates webpack.InputFileSystem instance using WrappedFs.
 * @internal
 */
export default class WrappedFs implements ts.System {
	public args: string[];
	public newLine: string;
	public useCaseSensitiveFileNames: boolean;

	public static readonly ROOT_PATH = rootPath;

	public fs: MemoryFileSystem;
	public baseSys: ts.System;

	public statMeta: StatMetaData;
	/** @internal */
	public watchers: WrappedFsWatcher[] = [];

	constructor() {
		const sys = ts.sys;
		this.baseSys = sys;
		this.args = sys.args;
		this.newLine = sys.newLine;
		this.useCaseSensitiveFileNames = sys.useCaseSensitiveFileNames;
		this.statMeta = {
			['']: true,
			ctime: new Date(0),
			mtime: new Date(0)
		};

		this.fs = new MemoryFileSystem();
	}

	public makeInputFileSystem(baseFs: webpack.InputFileSystem, tscBuildConfig: TscBuildConfig): webpack.InputFileSystem {
		if ((baseFs as any)._wrappedFs === this) {
			return baseFs;
		}
		const self = this;
		return <any>{
			_wrappedFs: this,
			purge(): void {
				baseFs.purge && baseFs.purge();
			},
			readFile(path: string, callback: (err: Error | undefined | null, contents: Buffer) => void): void {
				const p = parseWrappedFsPath(path);
				if (p === null) {
					return baseFs.readFile(path, callback);
				}
				return self.fs.readFile(p, callback);
			},
			readFileSync(path: string): Buffer {
				const p = parseWrappedFsPath(path);
				if (p === null) {
					return baseFs.readFileSync(path);
				}
				return self.fs.readFileSync(p);
			},
			readlink(path: string, callback: (err: Error | undefined | null, linkString: string) => void): void {
				const p = parseWrappedFsPath(path);
				if (p === null) {
					return baseFs.readlink(path, callback);
				}
				return self.fs.readlink(p, callback);
			},
			readlinkSync(path: string): string {
				const p = parseWrappedFsPath(path);
				if (p === null) {
					return baseFs.readlinkSync(path);
				}
				return self.fs.readlinkSync(p);
			},
			stat(path: string, callback: (err: Error | undefined | null, stats: any) => void): void {
				// special handle for path
				if (isTsProjectSourceFile(tscBuildConfig, path)) {
					path = convertTsFileNameToJs(tscBuildConfig, path);
				}
				// console.log('**** stat: path =', path);
				const p = parseWrappedFsPath(path);
				if (p === null) {
					return baseFs.stat(path, callback);
				}
				self.fs.stat(p, (err, stats: any) => {
					if (stats) {
						const pathArray = self.fs.pathToArray(p);
						const statMeta = getStatMeta(self.statMeta, pathArray);
						if (statMeta) {
							stats.ctime = statMeta.ctime;
							stats.mtime = statMeta.mtime;
						}
					}
					callback(err, stats);
				});
			},
			statSync(path: string): any {
				// special handle for path
				if (isTsProjectSourceFile(tscBuildConfig, path)) {
					path = convertTsFileNameToJs(tscBuildConfig, path);
				}
				// console.log('**** statSync: path =', path);
				const p = parseWrappedFsPath(path);
				if (p === null) {
					return baseFs.statSync(path);
				}
				const stats = self.fs.statSync(p) as any;
				if (stats) {
					const pathArray = self.fs.pathToArray(p);
					const statMeta = getStatMeta(self.statMeta, pathArray);
					if (statMeta) {
						stats.ctime = statMeta.ctime;
						stats.mtime = statMeta.mtime;
					}
				}
				return stats;
			},
			readdir(path: string, callback: (err: Error | null, result?: any) => void): void {
				const p = parseWrappedFsPath(path);
				if (p === null) {
					return (baseFs as any).readdir(path, callback);
				}
				let result: string[];
				try {
					result = self.getDirectories(path);
				} catch (e) {
					setImmediate(() => callback(e));
					return;
				}
				setImmediate(() => callback(null, result));
			},
			readdirSync(path: string): string[] {
				const p = parseWrappedFsPath(path);
				if (p === null) {
					return (baseFs as any).readdirSync(path);
				}
				return self.getDirectories(path);
			},
			createReadStream(
				path: string,
				options?: {
					start: number;
					end: number;
				}
			): any {
				const p = parseWrappedFsPath(path);
				if (p === null) {
					return (baseFs as any).createReadStream(path, options);
				}
				return self.fs.createReadStream(p, options);
			},
			exists(path: string, callback: (isExist: boolean) => void): void {
				const p = parseWrappedFsPath(path);
				if (p === null) {
					return (baseFs as any).exists(path, callback);
				}
				return self.fs.exists(p, callback);
			},
			existsSync(path: string): boolean {
				const p = parseWrappedFsPath(path);
				if (p === null) {
					return (baseFs as any).existsSync(path);
				}
				return self.fs.existsSync(p);
			},
			join(path: string, request: string): string {
				const p = parseWrappedFsPath(path);
				if (p === null) {
					return (baseFs as any).join(path, request);
				}
				return self.joinPath(path, request);
			},
			pathToArray(path: string): string[] {
				return (baseFs as any).pathToArray(path);
			},
			normalize(path: string): string {
				const p = parseWrappedFsPath(path);
				if (p === null) {
					return (baseFs as any).normalize(path);
				}
				return makeWrappedFsPath(normalizeWrappedFsPath(self.fs, p));
			}
		};
	}

	public isWrappedFsPath(pathName: string): boolean {
		return parseWrappedFsPath(pathName) !== null;
	}

	public joinPath(path1: string, path2: string) {
		const p1 = parseWrappedFsPath(path1);
		if (p1 !== null) {
			if (!/\/$/.test(path1) && !/^[\\\/]/.test(path2)) {
				path1 += '/';
			}
			return path1 + path2;
		} else {
			return nodePath.join(path1, path2);
		}
	}

	public relativePath(basePath: string, targetPath: string) {
		const p1 = parseWrappedFsPath(basePath);
		const p2 = parseWrappedFsPath(targetPath);
		if (p1 !== null && p2 !== null) {
			return nodePath.relative(p1, p2);
		} else {
			return nodePath.relative(basePath, targetPath);
		}
	}

	public isChildPath(basePath: string, targetPath: string) {
		const p1 = parseWrappedFsPath(basePath);
		const p2 = parseWrappedFsPath(targetPath);
		if (p1 !== null && p2 !== null) {
			return isChildPath(p1, p2);
		} else {
			return isChildPath(basePath, targetPath);
		}
	}

	////////////////////////////////////////////////////////////////////////////

	public watchFileSystem(
		baseWatchFileSystem: WatchFileSystem,
		files: string[],
		dirs: string[],
		missing: string[],
		startTime: number,
		options: webpack.ICompiler.WatchOptions,
		callback: WatchFileSystemWatchCallback,
		callbackUndelayed?: (file: string, mtime: number) => void
	): WatchManager {
		const man = new WrappedFsWatcher(
			this,
			baseWatchFileSystem,
			files,
			dirs,
			missing,
			startTime,
			options,
			callback,
			callbackUndelayed
		);
		this.watchers.push(man);
		return man;
	}

	public onFileDeleted(files: string[]) {
		files.forEach((file) => {
			const p = parseWrappedFsPath(file);
			if (p !== null) {
				const a = this.fs.pathToArray(p);
				this.fs.unlinkSync(p);
				removeStatMeta(this.statMeta, a, this.watchers);
			}
		});
	}

	////////////////////////////////////////////////////////////////////////////

	public write(s: string): void {
		this.baseSys.write(s);
	}

	public readFile(path: string, encoding?: string): string | undefined {
		const p = parseWrappedFsPath(path);
		if (p === null) {
			return this.baseSys.readFile(path, encoding);
		}
		return this.fs.readFileSync(p, encoding);
	}

	public getFileSize(path: string): number {
		const p = parseWrappedFsPath(path);
		if (p === null) {
			return this.baseSys.getFileSize ? this.baseSys.getFileSize(path) : 0;
		}
		return ('' + this.fs.readFileSync(p)).length;
	}

	public writeFile(path: string, data: string, writeByteOrderMark?: boolean): void {
		const p = parseWrappedFsPath(path);
		if (p === null) {
			return this.baseSys.writeFile(path, data, writeByteOrderMark);
		}
		const dirPos = p.lastIndexOf('/') + 1;
		const dirName = p.substring(0, dirPos);
		if (dirName && !this._directoryExistsMem(dirName)) {
			this.fs.mkdirpSync(dirName);
		}
		if (writeByteOrderMark) {
			data = byteOrderMarkIndicator + data;
		}
		this.fs.writeFileSync(p, data, 'utf8');

		const pathArray = this.fs.pathToArray(p);
		updateStatMeta(this.statMeta, pathArray, this.watchers);
	}

	/**
	 * @param pollingInterval this parameter is used in polling-based watchers and ignored in watchers that
	 * use native OS file watching
	 */
	public watchFile(path: string, callback: ts.FileWatcherCallback, pollingInterval?: number): ts.FileWatcher {
		const p = parseWrappedFsPath(path);
		if (p === null) {
			if (!this.baseSys.watchFile) {
				return { close() { } };
			}
			return this.baseSys.watchFile(path, callback, pollingInterval);
		}
		throw new Error('Not supported');
	}

	public watchDirectory(path: string, callback: ts.DirectoryWatcherCallback, recursive?: boolean): ts.FileWatcher {
		const p = parseWrappedFsPath(path);
		if (p === null) {
			if (!this.baseSys.watchDirectory) {
				return { close() { } };
			}
			return this.baseSys.watchDirectory(path, callback, recursive);
		}
		throw new Error('Not supported');
	}

	public resolvePath(path: string): string {
		const p = parseWrappedFsPath(path);
		if (p === null) {
			return this.baseSys.resolvePath(path);
		}

		return makeWrappedFsPath(normalizeWrappedFsPath(this.fs, p));
	}

	public fileExists(path: string): boolean {
		const p = parseWrappedFsPath(path);
		if (p === null) {
			return this.baseSys.fileExists(path);
		}

		return this.fs.existsSync(p);
	}

	private _directoryExistsMem(path: string): boolean {
		try {
			return this.fs.existsSync(path) && this.fs.statSync(path).isDirectory();
		} catch (_e) {
			return false;
		}
	}

	public directoryExists(path: string): boolean {
		const p = parseWrappedFsPath(path);
		if (p === null) {
			return this.baseSys.directoryExists(path);
		}
		return this._directoryExistsMem(p);
	}

	public createDirectory(path: string): void {
		const p = parseWrappedFsPath(path);
		if (p === null) {
			return this.baseSys.createDirectory(path);
		}

		if (!this._directoryExistsMem(p)) {
			this.fs.mkdirpSync(p);
			const pathArray = this.fs.pathToArray(p);
			updateStatMeta(this.statMeta, pathArray, this.watchers);
		}
	}

	public getExecutingFilePath(): string {
		return this.baseSys.getExecutingFilePath();
	}

	public getCurrentDirectory(): string {
		return this.baseSys.getCurrentDirectory();
	}

	public getDirectories(path: string): string[] {
		const p = parseWrappedFsPath(path);
		if (p === null) {
			return this.baseSys.getDirectories(path);
		}
		return this.fs.readdirSync(p).filter(
			(name) => this._directoryExistsMem(normalizeWrappedFsPath(this.fs, p + '/' + name))
		).map(makeWrappedFsPath);
	}

	public readDirectory(
		path: string,
		extensions?: ReadonlyArray<string>,
		exclude?: ReadonlyArray<string>,
		include?: ReadonlyArray<string>,
		depth?: number
	): string[] {
		const p = parseWrappedFsPath(path);
		if (p === null) {
			return this.baseSys.readDirectory(path, extensions, exclude, include, depth);
		}

		throw new Error('Not supported');
	}

	public getModifiedTime(path: string): Date {
		const p = parseWrappedFsPath(path);
		if (p === null) {
			return this.baseSys.getModifiedTime ? this.baseSys.getModifiedTime(path) : new Date(0);
		}
		const pathArray = this.fs.pathToArray(p);
		const statMeta = getStatMeta(this.statMeta, pathArray);
		return statMeta && statMeta.mtime || new Date(0);
	}

	/**
	 * This should be cryptographically secure.
	 * A good implementation is node.js' `crypto.createHash`. (https://nodejs.org/api/crypto.html#crypto_crypto_createhash_algorithm)
	 */
	public createHash(data: string): string {
		return this.baseSys.createHash ? this.baseSys.createHash(data) : '';
	}

	public getMemoryUsage(): number {
		return this.baseSys.getMemoryUsage ? this.baseSys.getMemoryUsage() : 0;
	}

	public exit(exitCode?: number): void {
		this.baseSys.exit(exitCode);
	}

	public realpath(path: string): string {
		const p = parseWrappedFsPath(path);
		if (p === null) {
			return this.baseSys.realpath ? this.baseSys.realpath(path) : path;
		}
		return makeWrappedFsPath(normalizeWrappedFsPath(this.fs, path));
	}

	public setTimeout(callback: (...args: any[]) => void, ms: number, ...args: any[]): any {
		if (!this.baseSys.setTimeout) {
			return setTimeout(callback, ms, args);
		} else {
			return this.baseSys.setTimeout(callback, ms, args);
		}
	}

	public clearTimeout(timeoutId: any): void {
		if (!this.baseSys.clearTimeout) {
			clearTimeout(timeoutId);
		} else {
			this.baseSys.clearTimeout(timeoutId);
		}
	}

	public clearScreen(): void {
		if (this.baseSys.clearScreen) {
			this.baseSys.clearScreen();
		}
	}
}
