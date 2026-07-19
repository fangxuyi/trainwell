// Config plugin that adds the TrainwellWidgets Live Activity extension.
// Runs during `expo prebuild` to modify the generated ios/ project.
// @ts-check

const {
  withXcodeProject,
  withInfoPlist,
  withDangerousMod,
  withEntitlementsPlist,
} = require("@expo/config-plugins");
const path = require("path");
const fs = require("fs");

const WIDGET_TARGET = "TrainwellWidgets";
const WIDGET_BUNDLE_ID = "com.trainwell.app.widgets";
const DEPLOYMENT_TARGET = "16.2";

// ─── Swift source file contents ────────────────────────────────────────────────

const TRAINWELL_ATTRIBUTES = `import ActivityKit
import Foundation

struct TrainwellAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var elapsedSeconds: Int
        var isRecording: Bool
        var timerStartedAt: Date?
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

private enum TrainwellPalette {
    static let background = Color(red: 0.027, green: 0.039, blue: 0.067)
    static let surface = Color(red: 0.063, green: 0.082, blue: 0.125)
    static let text = Color(red: 0.961, green: 0.969, blue: 0.980)
    static let muted = Color(red: 0.612, green: 0.655, blue: 0.722)
    static let lime = Color(red: 0.780, green: 0.953, blue: 0.420)
    static let limeDark = Color(red: 0.090, green: 0.208, blue: 0.114)
    static let warning = Color(red: 0.957, green: 0.780, blue: 0.420)
}

@available(iOS 16.2, *)
private struct LiveElapsedText: View {
    let state: TrainwellAttributes.ContentState

    var body: some View {
        Group {
            if state.isRecording, let timerStartedAt = state.timerStartedAt {
                Text(
                    timerInterval: timerStartedAt...Date.distantFuture,
                    countsDown: false,
                    showsHours: state.elapsedSeconds >= 3600
                )
            } else {
                Text(formatDuration(state.elapsedSeconds))
            }
        }
        .monospacedDigit()
    }
}

private func workoutLabel(_ attributes: TrainwellAttributes) -> String {
    attributes.workoutType.isEmpty ? "Training session" : attributes.workoutType
}

private func coachLabel(_ attributes: TrainwellAttributes) -> String {
    attributes.trainerName.isEmpty ? "Self-guided" : "with \\(attributes.trainerName)"
}

@available(iOS 16.2, *)
struct TrainwellLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TrainwellAttributes.self) { context in
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 11) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(context.state.isRecording ? TrainwellPalette.limeDark : Color(red: 0.21, green: 0.18, blue: 0.09))
                        Image(systemName: context.state.isRecording ? "waveform" : "pause.fill")
                            .font(.system(size: 15, weight: .black))
                            .foregroundColor(context.state.isRecording ? TrainwellPalette.lime : TrainwellPalette.warning)
                    }
                    .frame(width: 42, height: 42)

                    VStack(alignment: .leading, spacing: 3) {
                        Text("TRAINWELL")
                            .font(.system(size: 9, weight: .black))
                            .tracking(1.5)
                            .foregroundColor(TrainwellPalette.lime)
                        Text(workoutLabel(context.attributes))
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(TrainwellPalette.text)
                            .lineLimit(1)
                    }

                    Spacer(minLength: 8)

                    HStack(spacing: 5) {
                        Circle()
                            .fill(context.state.isRecording ? TrainwellPalette.lime : TrainwellPalette.warning)
                            .frame(width: 6, height: 6)
                        Text(context.state.isRecording ? "LIVE" : "PAUSED")
                            .font(.system(size: 8, weight: .black))
                            .tracking(0.8)
                            .foregroundColor(context.state.isRecording ? TrainwellPalette.lime : TrainwellPalette.warning)
                    }
                    .padding(.horizontal, 9)
                    .padding(.vertical, 6)
                    .background(TrainwellPalette.surface, in: Capsule())
                }

                HStack(alignment: .lastTextBaseline) {
                    LiveElapsedText(state: context.state)
                        .font(.system(size: 32, weight: .black, design: .rounded))
                        .foregroundColor(TrainwellPalette.text)
                    Spacer()
                    Text(coachLabel(context.attributes))
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(TrainwellPalette.muted)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 17)
            .padding(.vertical, 15)
            .activityBackgroundTint(TrainwellPalette.background)
            .activitySystemActionForegroundColor(TrainwellPalette.text)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 7) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 9, style: .continuous)
                                .fill(TrainwellPalette.limeDark)
                            Image(systemName: context.state.isRecording ? "waveform" : "pause.fill")
                                .font(.system(size: 11, weight: .black))
                                .foregroundColor(context.state.isRecording ? TrainwellPalette.lime : TrainwellPalette.warning)
                        }
                        .frame(width: 31, height: 31)
                        Text("TRAINWELL")
                            .font(.system(size: 9, weight: .black))
                            .tracking(1.1)
                            .foregroundColor(TrainwellPalette.lime)
                    }
                    .padding(.leading, 2)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    LiveElapsedText(state: context.state)
                        .font(.system(size: 17, weight: .black, design: .rounded))
                        .foregroundColor(TrainwellPalette.text)
                        .padding(.trailing, 2)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(workoutLabel(context.attributes))
                                .font(.system(size: 13, weight: .bold))
                                .foregroundColor(TrainwellPalette.text)
                            Text(coachLabel(context.attributes))
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundColor(TrainwellPalette.muted)
                        }
                        Spacer()
                        Text(context.state.isRecording ? "RECORDING" : "PAUSED")
                            .font(.system(size: 8, weight: .black))
                            .tracking(0.8)
                            .foregroundColor(context.state.isRecording ? TrainwellPalette.lime : TrainwellPalette.warning)
                    }
                    .padding(.horizontal, 2)
                    .padding(.bottom, 3)
                }
            } compactLeading: {
                Image(systemName: context.state.isRecording ? "waveform" : "pause.fill")
                    .foregroundColor(context.state.isRecording ? TrainwellPalette.lime : TrainwellPalette.warning)
                    .font(.system(size: 11, weight: .black))
            } compactTrailing: {
                LiveElapsedText(state: context.state)
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundColor(TrainwellPalette.text)
            } minimal: {
                Image(systemName: context.state.isRecording ? "waveform" : "pause.fill")
                    .foregroundColor(context.state.isRecording ? TrainwellPalette.lime : TrainwellPalette.warning)
                    .font(.system(size: 11, weight: .black))
            }
            .keylineTint(TrainwellPalette.lime)
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
import Foundation

struct TrainwellAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var elapsedSeconds: Int
        var isRecording: Bool
        var timerStartedAt: Date?
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
            let state = TrainwellAttributes.ContentState(
                elapsedSeconds: 0,
                isRecording: true,
                timerStartedAt: Date()
            )
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

    @objc(updateActivity:isRecording:resolver:rejecter:)
    func updateActivity(
        _ elapsedSeconds: NSNumber,
        isRecording: NSNumber,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        if #available(iOS 16.2, *) {
            guard let activity = currentActivity else { resolve(nil); return }
            let state = TrainwellAttributes.ContentState(
                elapsedSeconds: elapsedSeconds.intValue,
                isRecording: isRecording.boolValue,
                timerStartedAt: isRecording.boolValue
                    ? Date().addingTimeInterval(-elapsedSeconds.doubleValue)
                    : nil
            )
            Task { await activity.update(using: state); resolve(nil) }
        } else {
            resolve(nil)
        }
    }

    @objc(endActivity:resolver:rejecter:)
    func endActivity(
        _ elapsedSeconds: NSNumber,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        if #available(iOS 16.2, *) {
            guard let activity = currentActivity else { resolve(nil); return }
            let finalState = TrainwellAttributes.ContentState(
                elapsedSeconds: elapsedSeconds.intValue,
                isRecording: false,
                timerStartedAt: nil
            )
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
                  isRecording:(nonnull NSNumber *)isRecording
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(endActivity:(nonnull NSNumber *)elapsedSeconds
                  resolver:(RCTPromiseResolveBlock)resolve
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
      fs.writeFileSync(path.join(widgetDir, `${WIDGET_TARGET}-Info.plist`), WIDGET_INFO_PLIST);

      fs.writeFileSync(path.join(mainDir, "TrainwellAttributes.swift"), LIVE_ACTIVITY_ATTRIBUTES);
      fs.writeFileSync(path.join(mainDir, "LiveActivityModule.swift"), LIVE_ACTIVITY_MODULE_SWIFT);
      fs.writeFileSync(path.join(mainDir, "LiveActivityModule.m"), LIVE_ACTIVITY_MODULE_M);

      // Expose React bridge types to Swift — the generated bridging header is
      // empty by default and doesn't include RCTBridgeModule.h.
      const bridgingHeaderName = `${config.modRequest.projectName || "Trainwell"}-Bridging-Header.h`;
      const bridgingHeaderPath = path.join(mainDir, bridgingHeaderName);
      if (fs.existsSync(bridgingHeaderPath)) {
        const current = fs.readFileSync(bridgingHeaderPath, "utf8");
        if (!current.includes("RCTBridgeModule.h")) {
          fs.writeFileSync(
            bridgingHeaderPath,
            current + "\n#import <React/RCTBridgeModule.h>\n"
          );
        }
      }

      return config;
    },
  ]);
}

// ─── Step 2: Add widget target to Xcode project ───────────────────────────────

function withWidgetTarget(config) {
  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;

    const existingWidgetTarget = Object.entries(
      xcodeProject.pbxNativeTargetSection()
    ).find(
      ([key, target]) =>
        !key.endsWith("_comment") &&
        target?.name?.replaceAll('"', "") === WIDGET_TARGET
    );
    if (existingWidgetTarget) {
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

    // addTarget creates the native target with buildPhases:[]. The xcode
    // library's buildPhaseObject() falls back to the FIRST Sources phase it
    // finds when the target has no Sources phase yet — which is the main
    // app's phase. Explicitly create the widget's Sources phase first so
    // subsequent addSourceFile calls route to the correct target.
    xcodeProject.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", widgetTarget.uuid);

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
        file,
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
      // Main Trainwell group has no path, so file refs need the full
      // relative path (same pattern as AppDelegate.swift → "Trainwell/AppDelegate.swift").
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

    // Configure build settings for the widget target.
    // Navigate from the target → XCConfigurationList → individual config UUIDs
    // to avoid accidentally modifying other targets' configs.
    const configListUuid = widgetTarget.pbxNativeTarget.buildConfigurationList;
    const configList =
      xcodeProject.hash.project.objects["XCConfigurationList"][configListUuid];
    const widgetConfigUuids = (configList?.buildConfigurations || []).map(
      (c) => c.value
    );
    const allBuildConfigs = xcodeProject.pbxXCBuildConfigurationSection();
    widgetConfigUuids.forEach((uuid) => {
      const cfg = allBuildConfigs[uuid];
      if (!cfg?.buildSettings) return;
      const settings = cfg.buildSettings;
      settings.PRODUCT_BUNDLE_IDENTIFIER = `"${WIDGET_BUNDLE_ID}"`;
      settings.SWIFT_VERSION = "5.0";
      settings.TARGETED_DEVICE_FAMILY = '"1"';
      settings.IPHONEOS_DEPLOYMENT_TARGET = DEPLOYMENT_TARGET;
      if (devTeam) settings.DEVELOPMENT_TEAM = `"${devTeam}"`;
      settings.SKIP_INSTALL = "YES";
      settings.CODE_SIGN_STYLE = "Automatic";
      delete settings.ASSETCATALOG_COMPILER_APPICON_NAME;
    });

    // Note: addTarget('app_extension') already calls addTargetDependency(mainTarget, [widget])
    // and creates a "Copy Files" (dstSubfolderSpec=13 / PlugIns) phase in the main target
    // with the widget .appex product added. No manual addBuildPhase or addTargetDependency
    // calls needed — doing so creates duplicate/broken phases.

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

// ─── Step 4: Strip push-notifications entitlement ────────────────────────────
// expo-notifications auto-registers via app.plugin.js and writes
// aps-environment into the entitlements even when not listed in plugins[].
// Personal Apple developer teams can't provision push notifications, so we
// remove it here (we only use local notifications, not remote push).

function withNoPushEntitlement(config) {
  return withEntitlementsPlist(config, (config) => {
    delete config.modResults["aps-environment"];
    return config;
  });
}

// ─── Compose all mods ─────────────────────────────────────────────────────────

module.exports = function withLiveActivity(config) {
  config = withWidgetFiles(config);
  config = withWidgetTarget(config);
  config = withLiveActivityInfoPlist(config);
  config = withNoPushEntitlement(config);
  return config;
};
