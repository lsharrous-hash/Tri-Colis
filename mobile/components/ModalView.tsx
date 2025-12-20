import React from "react";
import { Modal, View, Text, StyleSheet, TouchableOpacity } from "react-native";
import theme from "../theme";

interface Props {
  visible: boolean;
  onRequestClose?: () => void;
  title?: string;
  children?: React.ReactNode;
}

export default function ModalView({ visible, onRequestClose, title, children }: Props) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onRequestClose} transparent>
      <View style={styles.backdrop}>
        <View style={styles.panel}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.32)",
  },
  panel: {
    backgroundColor: theme.Colors.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: theme.Spacing.md,
    minHeight: 200,
  },
  title: {
    fontSize: theme.Typography.h2,
    fontWeight: "700",
    marginBottom: theme.Spacing.sm,
  },
});
