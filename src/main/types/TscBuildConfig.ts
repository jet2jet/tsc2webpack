
import TscConfig from './TscConfig';

import WrappedFs from '../utils/WrappedFs';

/** @internal */
export default interface TscBuildConfig {
	configDirectory: string;
	data: TscConfig;
	configFileName?: string;
	extendedCompilerOptions?: object;
	wrappedFs?: WrappedFs | null;
}
