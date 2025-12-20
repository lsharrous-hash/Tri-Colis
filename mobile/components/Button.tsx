import React from "react";
import { TouchableOpacity, Text, StyleSheet, ViewStyle, TextStyle } from "react-native";
import theme from "../theme";

interface Props {
  title: string;
  onPress?: () => void;
  style?: ViewStyle;
  titleStyle?: TextStyle;
  outline?: boolean;
  disabled?: boolean;
}

export default function Button({ title, onPress, style, titleStyle, outline, disabled }: Props) {
  const bg = outline ? "transparent" : theme.Colors.primary;
  const color = outline ? theme.Colors.primary : "#fff";
  const borderColor = outline ? theme.Colors.primary : theme.Colors.subtleBorder;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, { backgroundColor: bg, borderColor }, style]}
    >
      <Text style={[styles.title, { color }, titleStyle]}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: theme.Spacing.md,
    paddingHorizontal: theme.Spacing.lg,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 3,
  },
  title: {
    fontSize: theme.Typography.body,
    fontWeight: "700",
  },
});
