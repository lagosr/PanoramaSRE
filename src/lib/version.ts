export interface AppVersionInfo {
  version: string;
  buildHash: string;
  buildDate: string;
  buildStamp: string;
  buildNumber: string;
  fullVersionString: string;
}

export const APP_VERSION_INFO: AppVersionInfo = {
  version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.2.1',
  buildHash: typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev',
  buildDate: typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : '',
  buildStamp: typeof __BUILD_STAMP__ !== 'undefined' ? __BUILD_STAMP__ : 'dev',
  buildNumber: typeof __BUILD_NUMBER__ !== 'undefined' ? __BUILD_NUMBER__ : 'dev',
  fullVersionString: `v${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.2.1'} (${typeof __BUILD_DATE__ !== 'undefined' && __BUILD_DATE__ ? `Build ${__BUILD_DATE__}` : 'Build dev'})`,
};
