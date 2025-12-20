// mobile/theme.ts
import { StyleSheet } from "react-native";

const Colors = {
  // Fond et surfaces
  bg: "#F7F9FC",
  surface: "#FFFFFF",
  surfaceMuted: "#F1F5F9",
  card: "#FFFFFF",
  subtleBorder: "#E2E8F0",
  borderStrong: "#CBD5E1",

  // Marque principale
  primary: "#2563EB",
  primarySoft: "#E5EDFF",

  // Accents secondaires (CANIAO, alertes)
  caniao: "#F97316",
  caniaoDark: "#9A3412",
  caniaoSoft: "#FFF4E5",
  caniaoBorder: "#FDBA74",

  // États
  success: "#10B981",
  warning: "#F59E0B",
  danger: "#EF4444",
  muted: "#64748B",
  text: "#0F172A",
  textMuted: "#64748B",

  glass: "rgba(255,255,255,0.6)",
};

const Typography = {
  h1: 28,
  h2: 22,
  body: 16,
  small: 12,
};

const Spacing = {
  xs: 6,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
};

export const theme = {
  Colors,
  Typography,
  Spacing,
};

export const common = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: Colors.bg,
    padding: Spacing.md,
  },
  sectionTitle: {
    fontSize: Typography.h2,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: Spacing.sm,
  },
});

export default theme;
