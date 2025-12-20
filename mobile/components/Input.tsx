import React from "react";
import { TextInput, StyleSheet, TextInputProps } from "react-native";
import theme from "../theme";

export default function Input(props: TextInputProps) {
  return <TextInput {...props} style={[styles.input, props.style]} />;
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: theme.Colors.subtleBorder,
    backgroundColor: theme.Colors.surface,
    paddingVertical: theme.Spacing.md,
    paddingHorizontal: theme.Spacing.md,
    borderRadius: 12,
    fontSize: theme.Typography.body,
    color: theme.Colors.text,
  },
});
