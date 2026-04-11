import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  CameraView,
  type CameraCapturedPicture,
  type CameraType,
  useCameraPermissions,
} from "expo-camera";
import { Ionicons } from "@expo/vector-icons";

interface CameraCaptureModalProps {
  visible: boolean;
  onCancel: () => void;
  onCapture: (asset: { uri: string; width: number; height: number }) => void;
}

export function CameraCaptureModal({
  visible,
  onCancel,
  onCapture,
}: CameraCaptureModalProps): React.JSX.Element | null {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>("back");
  const [isReady, setIsReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  // Reset transient state each time the modal opens.
  useEffect(() => {
    if (visible) {
      setIsReady(false);
      setIsCapturing(false);
      setFacing("back");
    }
  }, [visible]);

  // Request permission as soon as the modal opens if we don't yet have it.
  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [visible, permission, requestPermission]);

  const handleShutter = useCallback(async () => {
    if (!isReady || isCapturing) return;
    setIsCapturing(true);
    try {
      const photo: CameraCapturedPicture | undefined =
        await cameraRef.current?.takePictureAsync({
          quality: 0.8,
          skipProcessing: false,
          shutterSound: false,
        });
      if (photo?.uri) {
        onCapture({
          uri: photo.uri,
          width: photo.width ?? 0,
          height: photo.height ?? 0,
        });
      }
    } catch (err) {
      console.log("[CameraCaptureModal] takePictureAsync failed:", err);
    } finally {
      setIsCapturing(false);
    }
  }, [isReady, isCapturing, onCapture]);

  const handleFlip = useCallback(() => {
    setFacing((prev) => (prev === "back" ? "front" : "back"));
  }, []);

  if (!visible) return null;

  const permissionBlocked =
    permission !== null && !permission.granted && !permission.canAskAgain;
  const permissionPending = permission === null || !permission.granted;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={styles.root}>
        <StatusBar hidden={Platform.OS === "ios"} />

        {permission?.granted ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            mode="picture"
            onCameraReady={() => setIsReady(true)}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.permissionPane]}>
            {permissionBlocked ? (
              <Text style={styles.permissionText}>
                Camera access is blocked. Enable it in Settings → TensorChat →
                Camera.
              </Text>
            ) : (
              <ActivityIndicator color="#FFFFFF" />
            )}
          </View>
        )}

        {/* Top bar: Cancel */}
        <View style={styles.topBar} pointerEvents="box-none">
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            onPress={onCancel}
            style={styles.cancelButton}
            hitSlop={{ top: 12, left: 12, right: 12, bottom: 12 }}
          >
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Bottom bar: Shutter + Flip */}
        <View style={styles.bottomBar} pointerEvents="box-none">
          <View style={styles.bottomSlot} />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            onPress={handleShutter}
            disabled={!isReady || isCapturing || !permission?.granted}
            activeOpacity={0.75}
            style={[
              styles.shutterOuter,
              (!isReady || !permission?.granted) && styles.shutterDisabled,
            ]}
          >
            <View
              style={[
                styles.shutterInner,
                isCapturing && styles.shutterInnerCapturing,
              ]}
            />
          </TouchableOpacity>
          <View style={styles.bottomSlot}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Flip camera"
              onPress={handleFlip}
              disabled={!permission?.granted}
              hitSlop={{ top: 12, left: 12, right: 12, bottom: 12 }}
              style={styles.flipButton}
            >
              <Ionicons name="camera-reverse-outline" size={28} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000000",
  },
  permissionPane: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  permissionText: {
    color: "#FFFFFF",
    textAlign: "center",
    fontSize: 15,
    lineHeight: 22,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: Platform.OS === "ios" ? 52 : 20,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
  },
  cancelButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: Platform.OS === "ios" ? 44 : 24,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bottomSlot: {
    width: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  shutterDisabled: {
    borderColor: "rgba(255,255,255,0.4)",
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#FFFFFF",
  },
  shutterInnerCapturing: {
    backgroundColor: "rgba(255,255,255,0.6)",
    transform: [{ scale: 0.85 }],
  },
  flipButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
});
