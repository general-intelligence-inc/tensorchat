const fs = require('fs');
const path = require('path');
const {
  IOSConfig,
  createRunOncePlugin,
  withDangerousMod,
  withInfoPlist,
  withXcodeProject,
} = require('@expo/config-plugins');

const LAUNCH_STORYBOARD_NAME = 'SplashScreenV2';
const SOURCE_STORYBOARD_FILE = 'SplashScreen.storyboard';
const TARGET_STORYBOARD_FILE = `${LAUNCH_STORYBOARD_NAME}.storyboard`;

const withIosLaunchStoryboardCacheBust = (config) => {
  config = withInfoPlist(config, (config) => {
    config.modResults.UILaunchStoryboardName = LAUNCH_STORYBOARD_NAME;
    return config;
  });

  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const iosProjectRoot = config.modRequest.platformProjectRoot;
      const projectName = config.modRequest.projectName;
      const storyboardDirectory = path.join(iosProjectRoot, projectName);
      const sourceStoryboardPath = path.join(
        storyboardDirectory,
        SOURCE_STORYBOARD_FILE,
      );
      const targetStoryboardPath = path.join(
        storyboardDirectory,
        TARGET_STORYBOARD_FILE,
      );

      if (fs.existsSync(sourceStoryboardPath)) {
        await fs.promises.copyFile(sourceStoryboardPath, targetStoryboardPath);
      } else if (!fs.existsSync(targetStoryboardPath)) {
        throw new Error(
          `Expected ${SOURCE_STORYBOARD_FILE} or ${TARGET_STORYBOARD_FILE} in ${storyboardDirectory}`,
        );
      }

      return config;
    },
  ]);

  config = withXcodeProject(config, (config) => {
    const projectName = config.modRequest.projectName;
    const storyboardRelativePath = path.posix.join(
      projectName,
      TARGET_STORYBOARD_FILE,
    );

    if (!config.modResults.hasFile(storyboardRelativePath)) {
      IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath: storyboardRelativePath,
        groupName: projectName,
        project: config.modResults,
      });
    }

    return config;
  });

  return config;
};

module.exports = createRunOncePlugin(
  withIosLaunchStoryboardCacheBust,
  'with-ios-launch-storyboard-cache-bust',
  '1.0.0',
);