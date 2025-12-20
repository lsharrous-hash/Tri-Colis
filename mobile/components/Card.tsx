import React from "react";
import { View, Text, StyleSheet, ViewStyle } from "react-native";
import theme from "../theme";

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
}

export default function Card({ children, style }: Props) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.Colors.card,
    borderRadius: 12,
    padding: theme.Spacing.md,
    shadowColor: "#000",
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 2,
  },
});
