// Config plugin that adds the TrainwellWidgets Live Activity extension.
// Runs during `expo prebuild` to modify the generated ios/ project.
// @ts-check

const {
  withXcodeProject,
  withInfoPlist,
  withDangerousMod,
} = require("@expo/config-plugins");
const path = require("path");
const fs = require("fs");

const WIDGET_TARGET = "TrainwellWidgets";
const WIDGET_BUNDLE_ID = "com.trainwell.app.widgets";
const DEPLOYMENT_TARGET = "16.2";

// ─── Swift source file contents ────────────────────────────────────────────────

const TRAINWELL_ATTRIBUTES = `import ActivityKit

struct TrainwellAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var elapsedSeconds: Int
        var isRecording: Bool
    }
    var trainerName: String
    var workoutType: String
}
`;

const TRAINWELL_LIVE_ACTIVITY = `import ActivityKit
import WidgetKit
import SwiftUI

private func formatDuration(_ seconds: Int) -> String {
    let h = seconds / 3600
    let m = (seconds % 3600) / 60
    let s = seconds % 60
    if h > 0 { return String(format: "%d:%02d:%02d", h, m, s) }
    return String(format: "%02d:%02d", m, s)
}

@available(iOS 16.2, *)
struct TrainwellLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TrainwellAttributes.self) { context in
            HStack(spacing: 12) {
                Image(systemName: "record.circle.fill")
                    .foregroundColor(.red)
                    .font(.title2)
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.attributes.trainerName.isEmpty
                         ? "Trainwell Recording"
                         : "Recording with \\(context.attributes.trainerName)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(formatDuration(context.state.elapsedSeconds))
                        .font(.title2.monospacedDigit().bold())
                }
                Spacer()
            }
            .padding()
            .activityBackgroundTint(Color(red: 0.07, green: 0.07, blue: 0.1))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "record.circle.fill")
                        .foregroundColor(.red)
                        .font(.title3)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(formatDuration(context.state.elapsedSeconds))
                        .font(.callout.monospacedDigit().bold())
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.attributes.trainerName.isEmpty
                         ? "Trainwell"
                         : "with \\(context.attributes.trainerName)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            } compactLeading: {
                Image(systemName: "record.circle.fill")
                    .foregroundColor(.red)
                    .font(.caption)
            } compactTrailing: {
                Text(formatDuration(context.state.elapsedSeconds))
                    .font(.caption2.monospacedDigit().bold())
            } minimal: {
                Image(systemName: "record.circle.fill")
                    .foregroundColor(.red)
            }
        }
    }
}
`;

const TRAINWELL_WIDGET_BUNDLE = `import WidgetKit
import SwiftUI

@main
struct TrainwellWidgetBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.2, *) {
            TrainwellLiveActivityWidget()
        }
    }
}
`;

const WIDGET_INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>TrainwellWidgets</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.widgetkit-extension</string>
  </dict>
</dict>
</plist>
`;

// TrainwellAttributes duplicated in the main app target so ActivityKit calls compile.
const LIVE_ACTIVITY_ATTRIBUTES = `import ActivityKit

struct TrainwellAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var elapsedSeconds: Int
        var isRecording: Bool
    }
    var trainerName: String
    var workoutType: String
}
`;

const LIVE_ACTIVITY_MODULE_SWIFT = `import ActivityKit
import Foundation

@objc(LiveActivityModule)
class LiveActivityModule: NSObject {

    @available(iOS 16.2, *)
    private var currentActivity: Activity<TrainwellAttributes>?

    @objc(startActivity:workoutType:resolver:rejecter:)
    func startActivity(
        _ trainerName: String,
        workoutType: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        if #available(iOS 16.2, *) {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                reject("LIVE_ACTIVITY_DISABLED", "Live Activities are disabled on this device", nil)
                return
            }
            let attrs = TrainwellAttributes(trainerName: trainerName, workoutType: workoutType)
            let state = TrainwellAttributes.ContentState(elapsedSeconds: 0, isRecording: true)
            do {
                let activity = try Activity<TrainwellAttributes>.request(
                    attributes: attrs,
                    contentState: state,
                    pushType: nil
                )
                currentActivity = activity
                resolve(activity.id)
            } catch {
                reject("LIVE_ACTIVITY_ERROR", error.localizedDescription, error)
            }
        } else {
            reject("LIVE_ACTIVITY_UNSUPPORTED", "Live Activities require iOS 16.2+", nil)
        }
    }

    @objc(updateActivity:resolver:rejecter:)
    func updateActivity(
        _ elapsedSeconds: NSNumber,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        if #available(iOS 16.2, *) {
            guard let activity = currentActivity else { resolve(nil); return }
            let state = TrainwellAttributes.ContentState(
                elapsedSeconds: elapsedSeconds.intValue,
                isRecording: true
            )
            Task { await activity.update(using: state); resolve(nil) }
        } else {
            resolve(nil)
        }
    }

    @objc(endActivity:rejecter:)
    func endActivity(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        if #available(iOS 16.2, *) {
            guard let activity = currentActivity else { resolve(nil); return }
            let finalState = TrainwellAttributes.ContentState(elapsedSeconds: 0, isRecording: false)
            Task {
                await activity.end(using: finalState, dismissalPolicy: .immediate)
                self.currentActivity = nil
                resolve(nil)
            }
        } else {
            resolve(nil)
        }
    }

    @objc static func requiresMainQueueSetup() -> Bool { return false }
}
`;

const LIVE_ACTIVITY_MODULE_M = `#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(LiveActivityModule, NSObject)

RCT_EXTERN_METHOD(startActivity:(NSString *)trainerName
                  workoutType:(NSString *)workoutType
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(updateActivity:(nonnull NSNumber *)elapsedSeconds
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(endActivity:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
`;

// ─── Step 1: Write source files via withDangerousMod ──────────────────────────

function withWidgetFiles(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const iosDir = path.join(config.modRequest.platformProjectRoot);
      const widgetDir = path.join(iosDir, WIDGET_TARGET);
      const mainDir = path.join(iosDir, config.modRequest.projectName || "Trainwell");

      fs.mkdirSync(widgetDir, { recursive: true });

      fs.writeFileSync(path.join(widgetDir, "TrainwellAttributes.swift"), TRAINWELL_ATTRIBUTES);
      fs.writeFileSync(path.join(widgetDir, "TrainwellLiveActivity.swift"), TRAINWELL_LIVE_ACTIVITY);
      fs.writeFileSync(path.join(widgetDir, "TrainwellWidgetBundle.swift"), TRAINWELL_WIDGET_BUNDLE);
      fs.writeFileSync(path.join(widgetDir, "Info.plist"), WIDGET_INFO_PLIST);

      fs.writeFileSync(path.join(mainDir, "TrainwellAttributes.swift"), LIVE_ACTIVITY_ATTRIBUTES);
      fs.writeFileSync(path.join(mainDir, "LiveActivityModule.swift"), LIVE_ACTIVITY_MODULE_SWIFT);
      fs.writeFileSync(path.join(mainDir, "LiveActivityModule.m"), LIVE_ACTIVITY_MODULE_M);

      return config;
    },
  ]);
}

// ─── Step 2: Add widget target to Xcode project ───────────────────────────────

function withWidgetTarget(config) {
  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;

    // Skip if already added (idempotent)
    if (xcodeProject.pbxTargetByName(WIDGET_TARGET)) {
      return config;
    }

    const projectName = config.modRequest.projectName || "Trainwell";
    const devTeam = config.ios?.teamId || "";

    // Add the widget extension target
    const widgetTarget = xcodeProject.addTarget(
      WIDGET_TARGET,
      "app_extension",
      WIDGET_TARGET,
      WIDGET_BUNDLE_ID
    );

    // xcode 3.x addSourceFile/addResourceFile expect a UUID group key.
    // addTarget does NOT create a PBX group, so we create one explicitly.
    const widgetGroupKey = xcodeProject.addPbxGroup(
      [],
      WIDGET_TARGET,
      WIDGET_TARGET
    ).uuid;

    // Also wire the new group into the root project group so it appears
    // in the Xcode file navigator.
    const rootGroupKey = xcodeProject.findPBXGroupKey({ name: projectName })
      || xcodeProject.findPBXGroupKey({ path: projectName });
    if (rootGroupKey) {
      const rootGroup = xcodeProject.getPBXGroupByKey(rootGroupKey);
      if (rootGroup && !rootGroup.children.some((c) => c.value === widgetGroupKey)) {
        rootGroup.children.push({ value: widgetGroupKey, comment: WIDGET_TARGET });
      }
    }

    // Main app group key (created by expo prebuild, named after the project)
    const mainGroupKey = xcodeProject.findPBXGroupKey({ name: projectName })
      || xcodeProject.findPBXGroupKey({ path: projectName });

    // Add Swift source files to widget target
    const widgetSources = [
      "TrainwellAttributes.swift",
      "TrainwellLiveActivity.swift",
      "TrainwellWidgetBundle.swift",
    ];

    widgetSources.forEach((file) => {
      xcodeProject.addSourceFile(
        `${WIDGET_TARGET}/${file}`,
        { target: widgetTarget.uuid },
        widgetGroupKey
      );
    });

    // Info.plist is referenced via INFOPLIST_FILE build setting — no need
    // to add it to the PBX file navigator (addResourceFile crashes on
    // projects with no Resources PBX group).

    // Add native module files to main target
    const mainTarget = xcodeProject.pbxTargetByName(projectName);
    if (mainTarget) {
      xcodeProject.addSourceFile(
        `${projectName}/TrainwellAttributes.swift`,
        { target: mainTarget.uuid },
        mainGroupKey
      );
      xcodeProject.addSourceFile(
        `${projectName}/LiveActivityModule.swift`,
        { target: mainTarget.uuid },
        mainGroupKey
      );
      xcodeProject.addSourceFile(
        `${projectName}/LiveActivityModule.m`,
        { target: mainTarget.uuid },
        mainGroupKey
      );
    }

    // Configure build settings for the widget target
    const widgetBuildConfigs = xcodeProject.pbxXCBuildConfigurationSection();
    Object.keys(widgetBuildConfigs)
      .filter((key) => !key.endsWith("_comment"))
      .filter((key) => {
        const cfg = widgetBuildConfigs[key];
        return (
          cfg.buildSettings &&
          xcodeProject.getBuildConfigByName(key)?.target === widgetTarget.uuid
        );
      })
      .forEach((key) => {
        const settings = widgetBuildConfigs[key].buildSettings;
        settings.INFOPLIST_FILE = `"${WIDGET_TARGET}/Info.plist"`;
        settings.PRODUCT_BUNDLE_IDENTIFIER = `"${WIDGET_BUNDLE_ID}"`;
        settings.SWIFT_VERSION = "5.0";
        settings.TARGETED_DEVICE_FAMILY = '"1"';
        settings.IPHONEOS_DEPLOYMENT_TARGET = DEPLOYMENT_TARGET;
        settings.DEVELOPMENT_TEAM = devTeam ? `"${devTeam}"` : undefined;
        settings.SKIP_INSTALL = "YES";
        settings.CODE_SIGN_STYLE = "Automatic";
        delete settings.ASSETCATALOG_COMPILER_APPICON_NAME;
      });

    // Add dependency: main target → widget target
    if (mainTarget) {
      xcodeProject.addTargetDependency(mainTarget.uuid, [widgetTarget.uuid]);
    }

    // Add "Embed Foundation Extensions" copy phase to main target
    xcodeProject.addBuildPhase(
      [widgetTarget.uuid],
      "PBXCopyFilesBuildPhase",
      "Embed Foundation Extensions",
      mainTarget?.uuid,
      "13" // PlugIns/Extensions destination
    );

    return config;
  });
}

// ─── Step 3: Add NSSupportsLiveActivities to Info.plist ──────────────────────

function withLiveActivityInfoPlist(config) {
  return withInfoPlist(config, (config) => {
    config.modResults.NSSupportsLiveActivities = true;
    config.modResults.NSSupportsLiveActivitiesFrequentUpdates = true;
    return config;
  });
}

// ─── Compose all mods ─────────────────────────────────────────────────────────

module.exports = function withLiveActivity(config) {
  config = withWidgetFiles(config);
  config = withWidgetTarget(config);
  config = withLiveActivityInfoPlist(config);
  return config;
};
