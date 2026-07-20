import React, { useEffect, useRef, useState } from "react";
import { Animated, Modal, Pressable, StyleSheet, View } from "react-native";

export function BottomSheetModal({
  visible,
  onClose,
  closeLabel,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  closeLabel: string;
  children: React.ReactNode;
}) {
  const [rendered, setRendered] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    progress.stopAnimation();
    if (visible) {
      setRendered(true);
      progress.setValue(0);
      requestAnimationFrame(() => {
        Animated.spring(progress, {
          toValue: 1,
          damping: 22,
          stiffness: 230,
          mass: 0.8,
          useNativeDriver: true,
        }).start();
      });
      return;
    }

    if (rendered) {
      Animated.timing(progress, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setRendered(false);
      });
    }
  }, [progress, visible]);

  if (!rendered) return null;

  return (
    <Modal
      animationType="none"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible
    >
      <View style={styles.root}>
        <Animated.View
          pointerEvents="none"
          style={[styles.backdrop, { opacity: progress }]}
        />
        <Pressable
          accessibilityLabel={closeLabel}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          style={{
            opacity: progress,
            transform: [
              {
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [34, 0],
                }),
              },
            ],
          }}
        >
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(46,94,140,0.16)",
  },
});
