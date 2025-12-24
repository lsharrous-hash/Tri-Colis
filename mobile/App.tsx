// App.tsx
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Button as RNButton,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
  BackHandler,
  TouchableOpacity,
  Linking,
  KeyboardAvoidingView,
  Platform,
  Modal as RNModal,
  Keyboard,
  StatusBar,
} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from "expo-secure-store";
import theme from "./theme";
import AppButton from "./components/Button";
import Input from "./components/Input";
import Card from "./components/Card";
import ModalView from "./components/ModalView";
// Use themed AppButton for legacy <Button /> usages
const Button = AppButton;

import { CameraView, useCameraPermissions } from "expo-camera";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import * as NavigationBar from "expo-navigation-bar";
import { setBackgroundColorAsync } from "expo-system-ui";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

const getTodayDateString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDateString = (value: string) => {
  const parts = value.split("-");
  if (parts.length !== 3) return new Date();
  const [yearStr, monthStr, dayStr] = parts;
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
};

const formatDateToFrench = (dateStr: string | null | undefined) => {
  if (!dateStr) return "n/a";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
};

type UserRole = "ADMIN" | "DISPATCHER" | "TRIEUR";

interface User {
  id: number;
  login: string;
  role: UserRole;
  sousTraitantName?: string | null;
}

type Screen =
  | "ROLE_HOME"
  | "TRI_HOME"
  | "TRI_SCAN"
  | "TRI_REPORT"
  | "DISPATCHER_HOME"
  | "DISPATCHER_IMPORT"
  | "DISPATCHER_IMPORT_UNIFIE"
  | "DISPATCHER_TOURS"
  | "ADMIN_HOME"
  | "ADMIN_IMPORT_UNIFIE"
  | "ADMIN_USERS"
  | "PROFILE";

// ===== MODE DEV / PROD =====
// Mettre true pour tester en local, false pour la production
const DEV_MODE = true;
const API_BASE_URL = DEV_MODE ? "http://192.168.1.85:3000" : "https://trizee.onrender.com";

interface BackendColis {
  trackingNumber: string;
  orderNumber: number;
  chauffeurName: string;
  sousTraitantName: string;
  tourName: string;
  address: string;
  isCaniao?: boolean;
  isDispatcherImport?: boolean;
  date?: string; // Ajouté pour permettre le filtrage par date
}

interface BackendTour {
  id: number;
  date: string | null;
  chauffeurName: string;
  sousTraitantName: string;
  tourneeName: string;
  colisCount: number;
  sourceFile: string;
  isCaniao?: boolean;
  isDispatcherImport?: boolean;
}

export default function App() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  const [screen, setScreen] = useState<Screen>("ROLE_HOME");
  const [triDate, setTriDate] = useState<string>(getTodayDateString());
  const [triTotalColis, setTriTotalColis] = useState<number>(0);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Configurer la barre de navigation Android
  useEffect(() => {
    const setupNavigationBar = async () => {
      if (Platform.OS === 'android') {
        try {
          // Configurer la StatusBar
          StatusBar.setBarStyle('light-content');
          StatusBar.setBackgroundColor('#000000');
          
          // Configurer la barre de navigation avec expo-system-ui
          await setBackgroundColorAsync('#000000');
          
          // Configurer la barre de navigation avec expo-navigation-bar
          await NavigationBar.setBackgroundColorAsync("#000000");
          await NavigationBar.setButtonStyleAsync("light");
        } catch (e) {
          console.error("Erreur lors de la configuration de la barre de navigation:", e);
        }
      }
    };
    setupNavigationBar();
  }, []);

  // Charger les données de connexion sauvegardées au démarrage
  useEffect(() => {
    const loadAuth = async () => {
      try {
        const savedUser = await SecureStore.getItemAsync("currentUser");
        const savedToken = await SecureStore.getItemAsync("authToken");
        
        if (savedUser && savedToken) {
          setCurrentUser(JSON.parse(savedUser));
          setAuthToken(savedToken);
        }
      } catch (e) {
        console.error("Erreur lors du chargement des données de connexion:", e);
      } finally {
        setIsLoadingAuth(false);
      }
    };

    loadAuth();
  }, []);

  const handleLogin = async () => {
    setError(null);
    setIsLoggingIn(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      const res = await fetch(`${API_BASE_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const text = await res.text();
        setError("Erreur de connexion : " + text);
        return;
      }

      const data = await res.json();
      setCurrentUser(data.user);
      setAuthToken(data.token);
      
      // Sauvegarder dans le stockage sécurisé
      await SecureStore.setItemAsync("currentUser", JSON.stringify(data.user));
      await SecureStore.setItemAsync("authToken", data.token);
      
      setScreen("ROLE_HOME");
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setError("Connexion expirée. Le serveur ne répond pas (timeout 10s). Vérifie que le backend tourne sur " + API_BASE_URL);
      } else {
        setError(
          "Impossible de contacter le serveur sur " + API_BASE_URL + ". Vérifie : 1) Le backend est lancé 2) Le téléphone est sur le même Wi-Fi 3) L'adresse IP est correcte"
        );
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    // Supprimer du stockage sécurisé
    await SecureStore.deleteItemAsync("currentUser");
    await SecureStore.deleteItemAsync("authToken");
    
    setCurrentUser(null);
    setAuthToken(null);
    setLogin("");
    setPassword("");
    setError(null);
    setScreen("ROLE_HOME");
  };

  // Afficher un écran de chargement pendant la vérification de l'authentification
  if (isLoadingAuth) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
        <View style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
          <ActivityIndicator size="large" />
          <Text style={{ marginTop: 16 }}>Chargement...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentUser) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
        <View style={styles.container}>
        <View style={{ flex: 0.3 }} />
        <View style={{ alignItems: 'center', marginBottom: theme.Spacing.xl }}>
          <Text style={[styles.title, { fontSize: 32 }]}>Tri-Colis</Text>
          <Text style={{ fontSize: 14, color: theme.Colors.muted, marginTop: 8 }}>Gestion de tournées</Text>
        </View>
        
        <View style={{ paddingHorizontal: theme.Spacing.md, gap: theme.Spacing.md }}>
          <View style={{ shadowColor: '#000', shadowOpacity: 0.08, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, elevation: 3 }}>
            <Input
              placeholder="Identifiant (admin, dispatcheur, trieur)"
              value={login}
              onChangeText={setLogin}
              autoCapitalize="none"
              style={{ marginBottom: 0 }}
            />
          </View>
          
          <View style={{ shadowColor: '#000', shadowOpacity: 0.08, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, elevation: 3 }}>
            <Input
              placeholder="Mot de passe"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              style={{ marginBottom: 0 }}
            />
          </View>
          
          {error && <Text style={[styles.error, { marginVertical: theme.Spacing.sm }]}>{error}</Text>}
          
          {isLoggingIn ? (
            <View style={{ alignItems: 'center', paddingVertical: theme.Spacing.lg }}>
              <ActivityIndicator size="large" color={theme.Colors.primary} />
              <Text style={{ marginTop: theme.Spacing.sm, color: theme.Colors.muted }}>Connexion en cours...</Text>
            </View>
          ) : (
            <AppButton title="Se connecter" onPress={handleLogin} style={{ paddingVertical: theme.Spacing.md, marginTop: theme.Spacing.sm }} />
          )}
        </View>
      </View>
      </SafeAreaView>
    );
  }

  if (screen === "ROLE_HOME") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.Colors.bg }}>
        <RoleHomeScreen
          user={currentUser}
          onLogout={handleLogout}
          onGoToTri={() => setScreen("TRI_HOME")}
          onGoToTriReport={() => setScreen("TRI_REPORT")}
          onGoToDispatcher={() => setScreen("DISPATCHER_HOME")}
          onGoToAdmin={() => setScreen("ADMIN_HOME")}
          onGoToProfile={() => setScreen("PROFILE")}
        />
      </SafeAreaView>
    );
  }

  if (screen === "TRI_HOME") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.Colors.bg }}>
        <TriHomeScreen
          date={triDate}
          onChangeDate={setTriDate}
          onBack={() => setScreen("ROLE_HOME")}
          onStartScan={() => setScreen("TRI_SCAN")}
          onTotalColisChange={setTriTotalColis}
        />
      </SafeAreaView>
    );
  }

  if (screen === "TRI_SCAN") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.Colors.bg }}>
        <TriScanScreen
          date={triDate}
          totalColis={triTotalColis}
          onBack={() => setScreen("TRI_HOME")}
        />
      </SafeAreaView>
    );
  }

  if (screen === "TRI_REPORT") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.Colors.bg }}>
        <TriReportScreen
          onBack={() => setScreen("ROLE_HOME")}
          authToken={authToken}
          currentUser={currentUser}
        />
      </SafeAreaView>
    );
  }

  if (screen === "DISPATCHER_HOME") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.Colors.bg }}>
        <DispatcherHomeScreen
          onBack={() => setScreen("ROLE_HOME")}
          onGoToImport={() => setScreen("DISPATCHER_IMPORT_UNIFIE")}
          onGoToTours={() => setScreen("DISPATCHER_TOURS")}
          onGoToProfile={() => setScreen("PROFILE")}
          currentUser={currentUser}
        />
      </SafeAreaView>
    );
  }

  if (screen === "DISPATCHER_IMPORT_UNIFIE") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.Colors.bg }}>
        <DispatcherImportUnifieScreen
          onBack={() => setScreen("DISPATCHER_HOME")}
          authToken={authToken}
          currentUser={currentUser}
        />
      </SafeAreaView>
    );
  }

  if (screen === "DISPATCHER_IMPORT") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.Colors.bg }}>
        <DispatcherImportScreen
          onBack={() => setScreen("DISPATCHER_HOME")}
          authToken={authToken}
          user={currentUser}
        />
      </SafeAreaView>
    );
  }

  if (screen === "ADMIN_HOME") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.Colors.bg }}>
        <AdminHomeScreen
          onBack={() => setScreen("ROLE_HOME")}
          onGoToImport={() => setScreen("ADMIN_IMPORT_UNIFIE")}
          onGoToUsers={() => setScreen("ADMIN_USERS")}
        />
      </SafeAreaView>
    );
  }

  if (screen === "ADMIN_IMPORT_UNIFIE") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.Colors.bg }}>
        <AdminImportUnifieScreen
          onBack={() => setScreen("ADMIN_HOME")}
          authToken={authToken}
        />
      </SafeAreaView>
    );
  }

  if (screen === "ADMIN_USERS") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.Colors.bg }}>
        <AdminUsersScreen
          onBack={() => setScreen("ADMIN_HOME")}
          authToken={authToken}
        />
      </SafeAreaView>
    );
  }

  if (screen === "DISPATCHER_TOURS") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.Colors.bg }}>
        <DispatcherToursScreen
          authToken={authToken}
          currentUser={currentUser}
          onBack={() => setScreen("DISPATCHER_HOME")}
        />
      </SafeAreaView>
    );
  }

  if (screen === "PROFILE") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.Colors.bg }}>
        <ProfileScreen
          authToken={authToken}
          currentUser={currentUser}
          onBack={() => setScreen("ROLE_HOME")}
        />
      </SafeAreaView>
    );
  }

  return null;
}

// ===============
// ROLE_HOME
// ===============

interface RoleHomeProps {
  user: User;
  onLogout: () => void;
  onGoToTri: () => void;
  onGoToTriReport: () => void;
  onGoToDispatcher: () => void;
  onGoToAdmin: () => void;
  onGoToProfile: () => void;
}

function RoleHomeScreen({
  user,
  onLogout,
  onGoToTri,
  onGoToTriReport,
  onGoToDispatcher,
  onGoToAdmin,
  onGoToProfile,
}: RoleHomeProps) {
  return (
    <View style={styles.container}>
      <View style={{ paddingVertical: theme.Spacing.lg, marginBottom: theme.Spacing.xl }}>
        <Text style={[styles.title, { fontSize: 28, marginBottom: 4 }]}>Bonjour 👋</Text>
        <Text style={{ fontSize: 18, fontWeight: '600', color: theme.Colors.primary }}>{user.login.toUpperCase()}</Text>
        <Text style={{ fontSize: 12, color: theme.Colors.muted, marginTop: 8 }}>Rôle : {user.role}</Text>
      </View>

      {/* Boutons d'accès */}
      <View style={{ gap: theme.Spacing.lg }}>
        <View style={{
          backgroundColor: theme.Colors.primarySoft,
          borderLeftWidth: 4,
          borderLeftColor: theme.Colors.primary,
          borderRadius: 12,
          padding: theme.Spacing.md,
          marginBottom: theme.Spacing.sm
        }}>
          <Button title="📱 Accéder au tri (scan colis)" onPress={onGoToTri} />
        </View>

        {(user.role === "TRIEUR" || user.role === "ADMIN") && (
          <View style={{
            backgroundColor: theme.Colors.surfaceMuted,
            borderLeftWidth: 4,
            borderLeftColor: theme.Colors.success,
            borderRadius: 12,
            padding: theme.Spacing.md,
            marginBottom: theme.Spacing.sm
          }}>
            <Button title="📊 Rapport de tri" onPress={onGoToTriReport} />
          </View>
        )}

        {user.role === "DISPATCHER" && (
          <View style={{
            backgroundColor: theme.Colors.surfaceMuted,
            borderLeftWidth: 4,
            borderLeftColor: theme.Colors.caniao,
            borderRadius: 12,
            padding: theme.Spacing.md,
            marginBottom: theme.Spacing.sm
          }}>
            <Button title="📦 Espace dispatcheur" onPress={onGoToDispatcher} />
          </View>
        )}

        {user.role === "ADMIN" && (
          <View style={{
            backgroundColor: theme.Colors.surfaceMuted,
            borderLeftWidth: 4,
            borderLeftColor: theme.Colors.primary,
            borderRadius: 12,
            padding: theme.Spacing.md,
            marginBottom: theme.Spacing.sm
          }}>
            <Button title="⚙️ Espace administrateur" onPress={onGoToAdmin} />
          </View>
        )}
      </View>

      <View style={{ flex: 1 }} />
      
      {/* Bouton Mon Profil */}
      <View style={{
        backgroundColor: theme.Colors.surfaceMuted,
        borderLeftWidth: 4,
        borderLeftColor: '#8b5cf6',
        borderRadius: 12,
        padding: theme.Spacing.md,
        marginBottom: theme.Spacing.md,
      }}>
        <Button title="👤 Mon profil" onPress={onGoToProfile} />
      </View>
      
      <View style={{
        backgroundColor: theme.Colors.surfaceMuted,
        borderTopWidth: 1,
        borderTopColor: theme.Colors.subtleBorder,
        paddingTop: theme.Spacing.md,
      }}>
        <Button 
          title="Se déconnecter" 
          onPress={onLogout} 
          style={{ backgroundColor: "#E5E7EB", borderColor: "#6B7280" }}
          titleStyle={{ color: "#1F2937" }}
        />
      </View>
    </View>
  );
}

// ===============
// TRI_HOME
// ===============

interface TriHomeProps {
  date: string;
  onChangeDate: (d: string) => void;
  onBack: () => void;
  onStartScan: () => void;
  onTotalColisChange: (total: number) => void;
}

function TriHomeScreen({ date, onChangeDate, onBack, onStartScan, onTotalColisChange }: TriHomeProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [internalDate, setInternalDate] = useState<Date>(parseDateString(date));

  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [totalColis, setTotalColis] = useState<number | null>(null);

  // Gestion du bouton retour Android
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });

    return () => backHandler.remove();
  }, [onBack]);

  // Quand la date change (ou au début), on va chercher le nombre de colis
  useEffect(() => {
    setInternalDate(parseDateString(date));

    if (!date) {
      setTotalColis(null);
      setStatsError(null);
      return;
    }

    let cancelled = false;

    const fetchStats = async () => {
      setStatsLoading(true);
      setStatsError(null);
      setTotalColis(null);

      try {
        const res = await fetch(
          `${API_BASE_URL}/api/stats/date?date=${encodeURIComponent(date)}`
        );

        if (!res.ok) {
          const text = await res.text();
          if (!cancelled) {
            setStatsError(
              `Erreur lors du chargement du nombre de colis : ${text}`
            );
          }
          return;
        }

        const data = await res.json();
        if (!cancelled) {
          const total = data.totalColis ?? 0;
          setTotalColis(total);
          onTotalColisChange(total);
        }
      } catch (e: any) {
        if (!cancelled) {
          setStatsError(
            "Impossible de contacter le serveur. Vérifie qu'il est lancé et que le téléphone est sur le même Wi-Fi."
          );
        }
      } finally {
        if (!cancelled) {
          setStatsLoading(false);
        }
      }
    };

    fetchStats();

    return () => {
      cancelled = true;
    };
  }, [date]);

  const openPicker = () => {
    setShowPicker(true);
  };

  const onDateChange = (_event: any, selected?: Date) => {
    setShowPicker(false);
    if (selected) {
      setInternalDate(selected);
      const year = selected.getFullYear();
      const month = String(selected.getMonth() + 1).padStart(2, "0");
      const day = String(selected.getDate()).padStart(2, "0");
      onChangeDate(`${year}-${month}-${day}`);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>📦 Préparation du tri</Text>

      {/* Section Sélection de la date */}
      <View
        style={{
          backgroundColor: theme.Colors.primarySoft,
          borderLeftWidth: 4,
          borderLeftColor: theme.Colors.primary,
          borderRadius: 12,
          padding: theme.Spacing.md,
          marginBottom: theme.Spacing.lg,
        }}
      >
        <Text
          style={{
            fontSize: 14,
            fontWeight: "600",
            color: theme.Colors.text,
            marginBottom: theme.Spacing.sm,
          }}
        >
          Date du tri
        </Text>

        <TouchableOpacity onPress={openPicker}>
          <View
            style={{
              backgroundColor: theme.Colors.surface,
              borderWidth: 1,
              borderColor: theme.Colors.subtleBorder,
              borderRadius: 12,
              paddingVertical: theme.Spacing.md,
              paddingHorizontal: theme.Spacing.md,
            }}
          >
            <Text
              style={{
                fontSize: 16,
                color: theme.Colors.text,
                fontWeight: "500",
              }}
            >
              {formatDateToFrench(date)}
            </Text>
          </View>
        </TouchableOpacity>

        {showPicker && (
          <DateTimePicker
            value={internalDate}
            mode="date"
            display="default"
            onChange={onDateChange}
          />
        )}

        <Text
          style={{
            fontSize: 12,
            color: theme.Colors.muted,
            marginTop: theme.Spacing.sm,
            fontStyle: "italic",
          }}
        >
          Sélectionne la date correspondant à tes tournées importées
        </Text>
      </View>

      {/* Section Statistiques */}
      <View
        style={{
          backgroundColor: theme.Colors.surfaceMuted,
          borderRadius: 12,
          padding: theme.Spacing.md,
          marginBottom: theme.Spacing.lg,
        }}
      >
        <Text
          style={{
            fontSize: 14,
            fontWeight: "600",
            color: theme.Colors.text,
            marginBottom: theme.Spacing.md,
          }}
        >
          📊 Colis à trier
        </Text>

        {statsLoading && (
          <Text
            style={{
              fontSize: 14,
              color: theme.Colors.muted,
              textAlign: "center",
              paddingVertical: theme.Spacing.md,
            }}
          >
            Chargement...
          </Text>
        )}

        {!statsLoading && statsError && (
          <View
            style={{
              backgroundColor: "#FEE2E2",
              borderLeftWidth: 4,
              borderLeftColor: theme.Colors.danger,
              borderRadius: 8,
              padding: theme.Spacing.md,
            }}
          >
            <Text
              style={{
                color: theme.Colors.danger,
                fontSize: 14,
              }}
            >
              {statsError}
            </Text>
          </View>
        )}

        {!statsLoading && !statsError && totalColis !== null && (
          <View
            style={{
              backgroundColor: theme.Colors.surface,
              borderRadius: 8,
              padding: theme.Spacing.md,
              borderLeftWidth: 4,
              borderLeftColor: theme.Colors.primary,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                color: theme.Colors.muted,
                marginBottom: theme.Spacing.xs,
              }}
            >
              Nombre de colis
            </Text>
            <Text
              style={{
                fontSize: 28,
                fontWeight: "700",
                color: theme.Colors.primary,
              }}
            >
              {totalColis}
            </Text>
          </View>
        )}
      </View>

      {/* Section Actions */}
      <View style={{ flex: 1 }} />

      <View
        style={{
          gap: theme.Spacing.md,
          backgroundColor: theme.Colors.surfaceMuted,
          borderTopWidth: 1,
          borderTopColor: theme.Colors.subtleBorder,
          paddingTop: theme.Spacing.lg,
        }}
      >
        <Button title="▶️  Commencer le tri" onPress={onStartScan} />
        <Button 
          title="← Retour" 
          onPress={onBack}
          style={{ backgroundColor: "#E5E7EB", borderColor: "#6B7280" }}
          titleStyle={{ color: "#1F2937" }}
        />
      </View>
    </View>
  );
}



// ===============
// TRI_SCAN
// ===============

interface TriScanProps {
  date: string;
  totalColis: number;
  onBack: () => void;
}

interface ScannedColis extends BackendColis {
  timestamp: number;
}

function TriScanScreen({ date, totalColis, onBack }: TriScanProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const [scanningEnabled, setScanningEnabled] = useState(true);

  const [foundColis, setFoundColis] = useState<BackendColis | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannedHistory, setScannedHistory] = useState<ScannedColis[]>([]);
  const [scannedCodes, setScannedCodes] = useState<Set<string>>(new Set());

  // État pour la saisie manuelle
  const [manualCode, setManualCode] = useState("");
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);
  const [isManualMode, setIsManualMode] = useState(false); // Basculer entre scan et saisie manuelle

  // Demande de permission caméra
  useEffect(() => {
    if (!permission) {
      requestPermission();
    }
  }, [permission]);

  // Gérer le bouton retour du téléphone pour revenir à l'écran précédent
  useEffect(() => {
    const handleBackPress = () => {
      onBack();    // revient à l’écran de préparation du tri
      return true; // empêche Android de fermer l’app
    };

    const sub = BackHandler.addEventListener(
      "hardwareBackPress",
      handleBackPress
    );

    return () => {
      sub.remove();
    };
  }, [onBack]);

  const handleBarcodeScanned = async (result: { data: string; type: string }) => {
    if (!scanningEnabled) return;

    setScanningEnabled(false);
    setLastScannedCode(result.data);
    setError(null);
    setFoundColis(null);
    setNotFound(false);

    try {
      const response = await fetch(`${API_BASE_URL}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackingNumber: result.data,
          date,
        }),
      });

      if (response.status === 404) {
        setFoundColis(null);
        setNotFound(true);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else if (!response.ok) {
        const text = await response.text();
        setError(`Erreur serveur (${response.status}) : ${text}`);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else {
        const json: BackendColis = await response.json();
        // Filtrage strict sur la date du colis
        if (json.date !== date) {
          setFoundColis(null);
          setNotFound(true);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        } else {
          setFoundColis(json);
          // Ajouter à l'historique
          setScannedHistory(prev => [{ ...json, timestamp: Date.now() }, ...prev.slice(0, 9)]);
          // Ajouter au Set des codes scannés uniquement si nouveau
          setScannedCodes(prev => new Set(prev).add(result.data));
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } catch (e: any) {
      setError(
        "Impossible de contacter le serveur. Vérifie qu'il est lancé et que le téléphone est sur le même Wi-Fi."
      );
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }

    setTimeout(() => {
      setScanningEnabled(true);
    }, 800);
  };

  // Fonction pour soumettre un code manuellement
  const handleManualSubmit = async () => {
    const code = manualCode.trim().toUpperCase();
    if (!code) {
      setError("Veuillez entrer un numéro de colis.");
      return;
    }

    // Fermer le clavier et le modal immédiatement
    Keyboard.dismiss();
    setIsManualMode(false);

    setIsSubmittingManual(true);
    setLastScannedCode(code);
    setError(null);
    setFoundColis(null);
    setNotFound(false);

    try {
      const response = await fetch(`${API_BASE_URL}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackingNumber: code,
          date,
        }),
      });

      if (response.status === 404) {
        setFoundColis(null);
        setNotFound(true);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else if (!response.ok) {
        const text = await response.text();
        setError(`Erreur serveur (${response.status}) : ${text}`);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else {
        const json: BackendColis = await response.json();
        // Filtrage strict sur la date du colis
        if (json.date !== date) {
          setFoundColis(null);
          setNotFound(true);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        } else {
          setFoundColis(json);
          setManualCode(""); // Vider le champ après succès
          // Ajouter à l'historique
          setScannedHistory(prev => [{ ...json, timestamp: Date.now() }, ...prev.slice(0, 9)]);
          // Ajouter au Set des codes scannés uniquement si nouveau
          setScannedCodes(prev => new Set(prev).add(code));
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } catch (e: any) {
      setError(
        "Impossible de contacter le serveur. Vérifie qu'il est lancé et que le téléphone est sur le même Wi-Fi."
      );
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }

    setIsSubmittingManual(false);
  };

  if (!permission) {
    return (
      <View style={styles.container}>
        <Text>Vérification de la permission caméra...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={{ marginBottom: 16 }}>
          L'application n'a pas l'autorisation d'accéder à la caméra.
        </Text>
        <AppButton title="Autoriser la caméra" onPress={requestPermission} />
        <View style={{ height: 16 }} />
        <AppButton title="← Retour" onPress={onBack} style={{ backgroundColor: "#E5E7EB", borderWidth: 1, borderColor: "#6B7280" }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      {/* En-tête épuré */}
      <View style={{
        paddingTop: 48,
        paddingHorizontal: theme.Spacing.md,
        paddingBottom: theme.Spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: theme.Colors.subtleBorder,
        backgroundColor: theme.Colors.bg,
      }}>
        <Text style={{ fontSize: theme.Typography.h1, fontWeight: "700", color: "#0F172A", marginBottom: 4 }}>
          Tri des colis
        </Text>
        <Text style={{ fontSize: theme.Typography.small, color: theme.Colors.muted }}>
          {formatDateToFrench(date)} • {scannedCodes.size} / {totalColis} colis scannés
        </Text>
      </View>

      {/* Caméra - Zone principale */}
      <View style={{ flex: 1, backgroundColor: "#000", overflow: "hidden" }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          onBarcodeScanned={scanningEnabled && !isManualMode ? handleBarcodeScanned : undefined}
          barcodeScannerSettings={{
            barcodeTypes: [
              "qr", "code128", "code39", "code93", "ean13", "ean8", "upc_a", "upc_e", "itf14",
            ],
          }}
        />
        {/* Overlay guide de scan */}
        <View style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          justifyContent: "center",
          alignItems: "center",
          pointerEvents: "none",
        }}>
          <View style={{
            width: "70%",
            aspectRatio: 1,
            borderWidth: 2,
            borderColor: "rgba(255,255,255,0.3)",
            borderRadius: 12,
          }} />
        </View>
      </View>

      {/* Résultats */}
      <ScrollView
        style={{ flex: 0.6 }}
        contentContainerStyle={{ padding: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Résultat principal */}
        {foundColis && (
          <Card style={{ borderLeftWidth: 4, borderLeftColor: theme.Colors.success, marginBottom: theme.Spacing.sm }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: theme.Typography.small, color: theme.Colors.muted, fontWeight: "500", marginBottom: 4 }}>
                  ✓ COLIS TROUVÉ
                </Text>
                <Text style={{ fontSize: 32, fontWeight: "700", color: theme.Colors.success, marginBottom: 8 }}>
                  {foundColis.isDispatcherImport 
                    ? `#${foundColis.orderNumber || '?'}` 
                    : (foundColis.isCaniao ? '#' : (foundColis.orderNumber ? `#${foundColis.orderNumber}` : '#'))
                  }
                </Text>
                <Text style={{ fontSize: 32, fontWeight: "700", color: "#0F172A", marginBottom: 8 }}>
                  {foundColis.chauffeurName}
                </Text>
                <Text style={{ fontSize: theme.Typography.small, color: theme.Colors.muted, lineHeight: 18 }}>
                  {foundColis.address}
                </Text>
              </View>
            </View>
          </Card>
        )}

        {notFound && (
          <Card style={{ borderLeftWidth: 4, borderLeftColor: theme.Colors.danger, marginBottom: theme.Spacing.sm }}>
            <Text style={{ fontSize: theme.Typography.small, color: theme.Colors.danger, fontWeight: "600" }}>
              ✗ Colis non trouvé
            </Text>
            <Text style={{ fontSize: theme.Typography.small, color: "#991B1B", marginTop: theme.Spacing.xs }}>
              Ce numéro n'existe pas pour cette date.
            </Text>
          </Card>
        )}

        {error && (
          <Card style={{ borderLeftWidth: 4, borderLeftColor: theme.Colors.muted, marginBottom: theme.Spacing.sm }}>
            <Text style={{ fontSize: theme.Typography.body, color: "#9A3412" }}>{error}</Text>
          </Card>
        )}

        {/* Actions */}
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
          <AppButton title="Saisir code" onPress={() => setIsManualMode(true)} style={{ flex: 1, marginRight: 8 }} />
          <AppButton title="Retour" onPress={onBack} style={{ flex: 1, backgroundColor: "#E5E7EB", borderWidth: 1, borderColor: "#9CA3AF" }} />
        </View>

        {/* Historique compact */}
        {scannedHistory.length > 0 && (
          <View>
            <Text style={{ fontSize: 12, fontWeight: "600", color: "#666", marginBottom: 8, textTransform: "uppercase" }}>
              Historique
            </Text>
            {scannedHistory.slice(0, 3).map((colis, idx) => (
              <View
                key={idx}
                style={{
                  backgroundColor: "#F9FAFB",
                  borderRadius: 6,
                  padding: 10,
                  marginBottom: 6,
                  borderWidth: 1,
                  borderColor: "#F3F4F6",
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: "700", color: "#1F2937" }}>
                  {colis.isDispatcherImport 
                    ? `#${colis.orderNumber || '?'}` 
                    : (colis.isCaniao ? '#' : (colis.orderNumber ? `#${colis.orderNumber}` : '#'))
                  }
                </Text>
                <Text style={{ fontSize: 11, color: "#999" }}>
                  {new Date(colis.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Modal Saisie Manuelle - Apple-like bottom sheet */}
      <ModalView
        visible={isManualMode}
        onRequestClose={() => {
          setIsManualMode(false);
          setManualCode("");
        }}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView contentContainerStyle={{ paddingBottom: theme.Spacing.lg }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: theme.Typography.h2, fontWeight: "700" }}>Saisir le numéro</Text>
              <TouchableOpacity onPress={() => { setIsManualMode(false); setManualCode(""); }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={{ fontSize: 28, color: theme.Colors.muted }}>×</Text>
              </TouchableOpacity>
            </View>

            <View style={{ marginTop: theme.Spacing.md, marginBottom: theme.Spacing.lg }}>
              <Text style={{ fontSize: theme.Typography.small, color: theme.Colors.muted, marginBottom: theme.Spacing.sm }}>CODE SAISI</Text>
              <Card style={{ padding: theme.Spacing.lg }}>
                <Text style={{ fontSize: 42, fontWeight: "800", textAlign: "center", color: "#0F172A", letterSpacing: 2 }}>
                  {manualCode || "−"}
                </Text>
              </Card>
            </View>

            <Input
              placeholder="Tapez le code..."
              placeholderTextColor="#9CA3AF"
              value={manualCode}
              onChangeText={setManualCode}
              onSubmitEditing={handleManualSubmit}
              returnKeyType="done"
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              style={{ marginBottom: theme.Spacing.md }}
            />

            <AppButton
              title="Valider"
              onPress={handleManualSubmit}
              style={{ marginBottom: theme.Spacing.sm, backgroundColor: manualCode.trim() ? theme.Colors.success : theme.Colors.muted }}
            />

            <AppButton
              title="Annuler"
              onPress={() => { setIsManualMode(false); setManualCode(""); }}
              style={{ backgroundColor: theme.Colors.surface, borderWidth: 1, borderColor: theme.Colors.subtleBorder }}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </ModalView>
    </View>
  );
}


// ===============
// TRI_REPORT
// ===============

interface TriReportProps {
  onBack: () => void;
  authToken: string | null;
  currentUser: User | null;
}

function TriReportScreen({ onBack, authToken, currentUser }: TriReportProps) {
  const [date, setDate] = useState<string>(getTodayDateString());
  const [showPicker, setShowPicker] = useState(false);
  const [internalDate, setInternalDate] = useState<Date>(parseDateString(date));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<any>(null);

  // Gestion du bouton retour Android
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => backHandler.remove();
  }, [onBack]);

  useEffect(() => {
    setInternalDate(parseDateString(date));
    fetchReport(date);
  }, [date]);

  const fetchReport = async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      const sousTraitant = currentUser?.role === "DISPATCHER" ? currentUser.sousTraitantName : undefined;
      let url = `${API_BASE_URL}/api/stats/scan-report?date=${encodeURIComponent(d)}`;
      if (sousTraitant) {
        url += `&sousTraitant=${encodeURIComponent(sousTraitant)}`;
      }

      const res = await fetch(url, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });

      if (!res.ok) {
        throw new Error("Erreur serveur");
      }

      const data = await res.json();
      setReport(data);
    } catch (e: any) {
      setError("Impossible de charger le rapport.");
    } finally {
      setLoading(false);
    }
  };

  const openPicker = () => setShowPicker(true);

  const onDateChange = (_event: any, selected?: Date) => {
    setShowPicker(false);
    if (selected) {
      setInternalDate(selected);
      const year = selected.getFullYear();
      const month = String(selected.getMonth() + 1).padStart(2, "0");
      const day = String(selected.getDate()).padStart(2, "0");
      setDate(`${year}-${month}-${day}`);
    }
  };

  const progressPercent = report?.summary?.progressPercent || 0;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>📊 Rapport de tri</Text>

      {/* Sélecteur de date */}
      <View style={{ marginBottom: theme.Spacing.lg }}>
        <Text style={{ marginBottom: theme.Spacing.xs, fontWeight: "600", color: theme.Colors.text }}>
          Date :
        </Text>
        <TouchableOpacity onPress={openPicker}>
          <View style={[styles.input, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
            <Text style={{ color: theme.Colors.text }}>{formatDateToFrench(date)}</Text>
            <Text>📅</Text>
          </View>
        </TouchableOpacity>

        {showPicker && (
          <DateTimePicker
            value={internalDate}
            mode="date"
            display="default"
            onChange={onDateChange}
          />
        )}
      </View>

      <View style={{ marginBottom: theme.Spacing.md }}>
        <AppButton title="🔄 Rafraîchir" onPress={() => fetchReport(date)} />
      </View>

      {loading && <ActivityIndicator style={{ marginVertical: theme.Spacing.lg }} />}

      {error && (
        <View style={{
          backgroundColor: "#FEE2E2",
          borderLeftWidth: 4,
          borderLeftColor: theme.Colors.danger,
          borderRadius: 8,
          padding: theme.Spacing.md,
          marginBottom: theme.Spacing.md,
        }}>
          <Text style={{ color: theme.Colors.danger, fontSize: 12, fontWeight: "500" }}>
            {error}
          </Text>
        </View>
      )}

      {report && !loading && (
        <>
          {/* Résumé */}
          <View style={{
            backgroundColor: theme.Colors.primarySoft,
            borderRadius: 12,
            padding: theme.Spacing.lg,
            marginBottom: theme.Spacing.lg,
          }}>
            <Text style={{ fontWeight: "bold", fontSize: 16, marginBottom: theme.Spacing.md, color: theme.Colors.text }}>
              📦 Résumé
            </Text>
            <Text style={{ color: theme.Colors.text, marginBottom: 4 }}>
              Total colis uniques : <Text style={{ fontWeight: "600" }}>{report.summary?.totalUnique || 0}</Text>
            </Text>
            <Text style={{ color: theme.Colors.success, marginBottom: 4 }}>
              ✅ Scannés : <Text style={{ fontWeight: "600" }}>{report.summary?.scanned || 0}</Text>
            </Text>
            <Text style={{ color: theme.Colors.danger, marginBottom: theme.Spacing.md }}>
              ⏳ Restants : <Text style={{ fontWeight: "600" }}>{report.summary?.unscanned || 0}</Text>
            </Text>

            {/* Barre de progression */}
            <View style={{
              height: 24,
              backgroundColor: theme.Colors.surfaceMuted,
              borderRadius: 12,
              overflow: "hidden",
            }}>
              <View style={{
                height: "100%",
                width: `${progressPercent}%`,
                backgroundColor: progressPercent === 100 ? theme.Colors.success : theme.Colors.primary,
                borderRadius: 12,
                justifyContent: "center",
                alignItems: "center",
              }}>
                <Text style={{ color: "#fff", fontWeight: "bold", fontSize: 12 }}>
                  {progressPercent}%
                </Text>
              </View>
            </View>
          </View>

          {/* Stats par scanneur */}
          {report.scannerStats && Object.keys(report.scannerStats).length > 0 && (
            <View style={{
              backgroundColor: theme.Colors.surface,
              borderWidth: 1,
              borderColor: theme.Colors.subtleBorder,
              borderRadius: 12,
              padding: theme.Spacing.md,
              marginBottom: theme.Spacing.lg,
            }}>
              <Text style={{ fontWeight: "bold", fontSize: 14, marginBottom: theme.Spacing.sm, color: theme.Colors.text }}>
                👥 Par scanneur
              </Text>
              {Object.entries(report.scannerStats)
                .sort((a: any, b: any) => b[1] - a[1])
                .map(([scanner, count]: [string, any]) => (
                  <View key={scanner} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                    <Text style={{ color: theme.Colors.text }}>{scanner}</Text>
                    <Text style={{ fontWeight: "600", color: theme.Colors.primary }}>{count} colis</Text>
                  </View>
                ))}
            </View>
          )}

          {/* Colis non scannés */}
          {report.unscannedColis && report.unscannedColis.length > 0 && (
            <View style={{
              backgroundColor: "#FEF2F2",
              borderWidth: 1,
              borderColor: "#FECACA",
              borderRadius: 12,
              padding: theme.Spacing.md,
              marginBottom: theme.Spacing.lg,
            }}>
              <Text style={{ fontWeight: "bold", fontSize: 14, marginBottom: theme.Spacing.sm, color: theme.Colors.danger }}>
                ❌ Non scannés ({report.unscannedColis.length})
              </Text>
              {report.unscannedColis.slice(0, 15).map((c: any, i: number) => (
                <View key={i} style={{ marginBottom: theme.Spacing.sm, borderBottomWidth: 1, borderBottomColor: "#FECACA", paddingBottom: theme.Spacing.xs }}>
                  <Text style={{ fontSize: 12, fontFamily: "monospace", color: theme.Colors.text }}>{c.trackingNumber}</Text>
                  <Text style={{ fontSize: 10, color: theme.Colors.muted }}>
                    {c.chauffeur} - {c.tourType}
                  </Text>
                </View>
              ))}
              {report.unscannedColis.length > 15 && (
                <Text style={{ color: theme.Colors.muted, fontSize: 12, fontStyle: "italic" }}>
                  ... et {report.unscannedColis.length - 15} autres
                </Text>
              )}
            </View>
          )}
        </>
      )}

      <View style={{
        backgroundColor: theme.Colors.surfaceMuted,
        borderTopWidth: 1,
        borderTopColor: theme.Colors.subtleBorder,
        paddingTop: theme.Spacing.lg,
        marginTop: theme.Spacing.lg,
      }}>
        <AppButton title="← Retour" onPress={onBack} />
      </View>
    </ScrollView>
  );
}


// ===============
// DISPATCHER_HOME
// ===============

interface DispatcherHomeProps {
  onBack: () => void;
  onGoToImport: () => void;
  onGoToTours: () => void;
  onGoToProfile: () => void;
  currentUser: User | null;
}

function DispatcherHomeScreen({ onBack, onGoToImport, onGoToTours, onGoToProfile, currentUser }: DispatcherHomeProps) {
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => backHandler.remove();
  }, [onBack]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🚚 Espace Sous-traitant</Text>
      
      {/* Info sous-traitant */}
      <View style={{
        backgroundColor: theme.Colors.surface,
        padding: 16,
        borderRadius: 12,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: theme.Colors.subtleBorder,
      }}>
        <Text style={{ color: theme.Colors.textMuted, fontSize: 13 }}>Connecté en tant que</Text>
        <Text style={{ color: theme.Colors.text, fontSize: 18, fontWeight: 'bold', marginTop: 4 }}>
          {currentUser?.sousTraitantName || currentUser?.login}
        </Text>
      </View>
      
      {/* Menu principal */}
      <View style={{ gap: 12 }}>
        <TouchableOpacity
          onPress={onGoToImport}
          style={{
            backgroundColor: theme.Colors.success,
            padding: 18,
            borderRadius: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 24 }}>🚀</Text>
          <View>
            <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>Import & Tournées</Text>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>Importer et gérer vos tournées</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onGoToTours}
          style={{
            backgroundColor: theme.Colors.primary,
            padding: 18,
            borderRadius: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 24 }}>📊</Text>
          <View>
            <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>Mes Chauffeurs</Text>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>Vue mutualisée et exports</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onGoToProfile}
          style={{
            backgroundColor: theme.Colors.surface,
            padding: 18,
            borderRadius: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            borderWidth: 1,
            borderColor: theme.Colors.subtleBorder,
          }}
        >
          <Text style={{ fontSize: 24 }}>👤</Text>
          <View>
            <Text style={{ color: theme.Colors.text, fontWeight: 'bold', fontSize: 16 }}>Mon Profil</Text>
            <Text style={{ color: theme.Colors.textMuted, fontSize: 12 }}>Modifier mot de passe</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onBack}
          style={{
            backgroundColor: theme.Colors.muted,
            padding: 16,
            borderRadius: 10,
            alignItems: 'center',
            marginTop: 8,
          }}
        >
          <Text style={{ color: '#fff', fontWeight: 'bold' }}>← Retour</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ===============
// DISPATCHER_IMPORT
// ===============

interface DispatcherImportProps {
  onBack: () => void;
  authToken: string | null;
  user: User;
}

function DispatcherImportScreen({
  onBack,
  authToken,
  user,
}: DispatcherImportProps) {
  const [date, setDate] = useState<string>(getTodayDateString());
  const [sousTraitantName, setSousTraitantName] = useState<string>(
    user.sousTraitantName || ""
  );
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Gestion du date picker
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [internalDate, setInternalDate] = useState<Date>(parseDateString(date));

  useEffect(() => {
    setInternalDate(parseDateString(date));
  }, [date]);

  // Gestion du bouton retour Android
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });

    return () => backHandler.remove();
  }, [onBack]);

  const openDatePicker = () => {
    setShowDatePicker(true);
  };

  const onDateChange = (_event: any, selected?: Date) => {
    setShowDatePicker(false);
    if (selected) {
      setInternalDate(selected);
      const year = selected.getFullYear();
      const month = String(selected.getMonth() + 1).padStart(2, "0");
      const day = String(selected.getDate()).padStart(2, "0");
      setDate(`${year}-${month}-${day}`);
    }
  };

  const pickFile = async () => {
    setMessage(null);
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      copyToCacheDirectory: true,
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets[0];
    setFile(asset);
  };

  const handleImport = async () => {
    setMessage(null);
    setError(null);

    if (!authToken) {
      setError("Vous n'êtes pas connecté (token manquant).");
      return;
    }

    // Harmonisation: date obligatoire pour tous, sous-traitant requis sauf pour ADMIN
    if (!date) {
      setError("La date est obligatoire.");
      return;
    }
    if (user.role !== "ADMIN" && !sousTraitantName) {
      setError(
        user.role === "DISPATCHER"
          ? "Votre compte dispatcheur n'a pas de sous-traitant configuré. Vérifiez le fichier users.json."
          : "Le sous-traitant est obligatoire."
      );
      return;
    }

    if (!file) {
      setError("Veuillez choisir un fichier Spoke (.txt) avant d'importer.");
      return;
    }

    try {
      setLoading(true);

      const formData = new FormData();
      formData.append("date", date);
      if (user.role !== "ADMIN") {
        formData.append("sousTraitantName", sousTraitantName);
      }

      formData.append("file", {
        uri: file.uri,
        name: file.name ?? "tournee.txt",
        type: file.mimeType ?? "text/plain",
      } as any);

      const response = await fetch(`${API_BASE_URL}/api/tours/import`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        setError(`Erreur lors de l'import (${response.status}) : ${text}`);
      } else {
        const json = await response.json();
        setMessage(
          `Tournée importée : ${json.tour.tourneeName} (${json.tour.colisCount} colis)`
        );
      }
    } catch (e: any) {
      setError(
        "Impossible de contacter le serveur. Vérifie qu'il est lancé et que le téléphone est sur le même Wi-Fi."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Importer une tournée Spoke</Text>

        <Text style={{ marginBottom: 6 }}>Date de la tournée :</Text>
        <TouchableOpacity onPress={openDatePicker}>
          <View style={styles.input}>
            <Text>{formatDateToFrench(date)}</Text>
          </View>
        </TouchableOpacity>

        {showDatePicker && (
          <DateTimePicker
            value={internalDate}
            mode="date"
            display="default"
            onChange={onDateChange}
          />
        )}

        <Text style={{ marginTop: 12, marginBottom: 6 }}>Sous-traitant :</Text>
        {user.role === "DISPATCHER" ? (
          <View style={{ marginBottom: 12 }}>
            <Text>{sousTraitantName || "(non défini dans le compte)"}</Text>
          </View>
        ) : (
          <Input
            style={styles.input}
            value={sousTraitantName}
            onChangeText={setSousTraitantName}
          />
        )}

        <View style={{ marginVertical: 12 }}>
          <AppButton title="Choisir un fichier (.pdf ou .xlsx)" onPress={pickFile} />
          <Text style={{ fontSize: 12, marginTop: 4 }}>
            {file ? `Fichier sélectionné : ${file.name}` : "Aucun fichier sélectionné"}
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator />
        ) : (
          <View style={{ marginBottom: 16 }}>
            <AppButton title="Importer la tournée" onPress={handleImport} />
          </View>
        )}

        {message && (
          <Text style={{ color: "green", marginBottom: 8 }}>{message}</Text>
        )}
        {error && <Text style={{ color: "red", marginBottom: 8 }}>{error}</Text>}

        <AppButton title="Retour" onPress={onBack} style={{ backgroundColor: theme.Colors.muted }} />
      </ScrollView>
    </View>
  );
}


// ===============
// ADMIN_IMPORT_UNIFIE
// ===============

interface ChauffeurSummary {
  chauffeur: string;
  sousTraitant: string;
  gofo: { count: number };
  cainiao: { count: number };
  total: number;
}

interface UnknownChauffeur {
  name: string;
  colisCount: number;
  stats: { gofo: number; cainiao: number };
}

interface AdminImportUnifieProps {
  onBack: () => void;
  authToken: string | null;
}

function AdminImportUnifieScreen({ onBack, authToken }: AdminImportUnifieProps) {
  const [date, setDate] = useState<string>(getTodayDateString());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [internalDate, setInternalDate] = useState<Date>(parseDateString(getTodayDateString()));
  
  // État des fichiers
  const [files, setFiles] = useState<DocumentPicker.DocumentPickerAsset[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  
  // Résumé des chauffeurs
  const [summary, setSummary] = useState<ChauffeurSummary[]>([]);
  const [totals, setTotals] = useState({ gofo: 0, cainiao: 0, total: 0 });
  const [loadingSummary, setLoadingSummary] = useState(false);
  
  // Modal chauffeurs inconnus
  const [showUnknownModal, setShowUnknownModal] = useState(false);
  const [unknownChauffeurs, setUnknownChauffeurs] = useState<UnknownChauffeur[]>([]);
  const [pendingFiles, setPendingFiles] = useState<DocumentPicker.DocumentPickerAsset[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [availableST, setAvailableST] = useState<string[]>([]);
  
  // Messages
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Charger le résumé au changement de date
  useEffect(() => {
    loadSummary();
  }, [date]);

  // Gestion du bouton retour Android
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showUnknownModal) {
        setShowUnknownModal(false);
        return true;
      }
      onBack();
      return true;
    });
    return () => backHandler.remove();
  }, [onBack, showUnknownModal]);

  const onDateChange = (_event: any, selected?: Date) => {
    setShowDatePicker(false);
    if (selected) {
      setInternalDate(selected);
      const year = selected.getFullYear();
      const month = String(selected.getMonth() + 1).padStart(2, "0");
      const day = String(selected.getDate()).padStart(2, "0");
      setDate(`${year}-${month}-${day}`);
    }
  };

  const loadSummary = async () => {
    if (!authToken || !date) return;
    
    setLoadingSummary(true);
    setError(null); // Effacer les erreurs précédentes
    try {
      const res = await fetch(`${API_BASE_URL}/api/chauffeurs/summary/${date}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      
      if (res.ok) {
        const data = await res.json();
        setSummary(data.chauffeurs || []);
        setTotals(data.totals || { gofo: 0, cainiao: 0, total: 0 });
      } else {
        console.error("Erreur summary:", res.status);
        setSummary([]);
        setTotals({ gofo: 0, cainiao: 0, total: 0 });
      }
    } catch (e) {
      console.error("Erreur chargement summary:", e);
      setSummary([]);
      setTotals({ gofo: 0, cainiao: 0, total: 0 });
    } finally {
      setLoadingSummary(false);
    }
  };

  const pickFiles = async () => {
    setMessage(null);
    setError(null);
    
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
      ],
      multiple: true,
      copyToCacheDirectory: true,
    });

    if (result.canceled) return;
    
    setFiles(prev => [...prev, ...result.assets]);
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const importFiles = async () => {
    if (!authToken || files.length === 0) {
      setError("Sélectionnez au moins un fichier");
      return;
    }

    setImporting(true);
    setImportProgress({ current: 0, total: files.length });
    setMessage(null);
    setError(null);

    let successCount = 0;
    let totalColis = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setImportProgress({ current: i + 1, total: files.length });

      try {
        const formData = new FormData();
        formData.append("date", date);
        formData.append("file", {
          uri: file.uri,
          name: file.name ?? "import.xlsx",
          type: file.mimeType ?? "application/octet-stream",
        } as any);

        const res = await fetch(`${API_BASE_URL}/api/import/unified`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
          body: formData,
        });

        const data = await res.json();

        if (res.ok) {
          successCount++;
          totalColis += data.totalImported || 0;
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else if (data.error === "UNKNOWN_CHAUFFEURS") {
          // Chauffeurs inconnus - ouvrir le modal
          setUnknownChauffeurs(data.unknownChauffeurs || []);
          setAvailableST(data.sousTraitants || []);
          setPendingFiles([file]);
          setShowUnknownModal(true);
          setImporting(false);
          return;
        } else {
          console.error("Erreur import:", data.message);
        }
      } catch (e) {
        console.error("Erreur import fichier:", e);
      }
    }

    setImporting(false);
    setFiles([]);
    
    if (successCount > 0) {
      setMessage(`✅ ${successCount} fichier(s) importé(s) - ${totalColis} colis`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      loadSummary();
    } else {
      setError("Aucun fichier importé");
    }
  };

  const handleAssignAndRetry = async () => {
    if (!authToken || pendingFiles.length === 0) return;

    // Vérifier que tous les chauffeurs sont assignés
    for (const ch of unknownChauffeurs) {
      if (!assignments[ch.name]) {
        Alert.alert("Erreur", `Assignez un sous-traitant pour ${ch.name}`);
        return;
      }
    }

    setShowUnknownModal(false);
    setImporting(true);

    try {
      const file = pendingFiles[0];
      const formData = new FormData();
      formData.append("date", date);
      formData.append("chauffeurAssignments", JSON.stringify(assignments));
      formData.append("file", {
        uri: file.uri,
        name: file.name ?? "import.xlsx",
        type: file.mimeType ?? "application/octet-stream",
      } as any);

      const res = await fetch(`${API_BASE_URL}/api/import/unified`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        setMessage(`✅ Import réussi - ${data.totalImported || 0} colis`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        loadSummary();
      } else {
        setError(data.message || "Erreur import");
      }
    } catch (e) {
      setError("Erreur réseau");
    } finally {
      setImporting(false);
      setPendingFiles([]);
      setAssignments({});
      setFiles([]);
    }
  };

  const deleteAllTours = async () => {
    Alert.alert(
      "⚠️ Supprimer tout",
      `Supprimer TOUTES les tournées du ${formatDateToFrench(date)} ?`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: async () => {
            setError(null);
            setMessage(null);
            try {
              const res = await fetch(
                `${API_BASE_URL}/api/admin/tours/all?date=${date}`,
                {
                  method: "DELETE",
                  headers: { Authorization: `Bearer ${authToken}` },
                }
              );
              
              const data = await res.json();
              
              if (res.ok) {
                setMessage(`✅ ${data.deletedColis || 0} colis supprimés`);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                loadSummary();
              } else {
                setError(data.message || `Erreur ${res.status}`);
              }
            } catch (e: any) {
              setError(`Erreur réseau: ${e.message || 'Connexion impossible'}`);
            }
          },
        },
      ]
    );
  };

  const deleteChauffeur = async (chauffeurName: string) => {
    Alert.alert(
      "Supprimer",
      `Supprimer les tournées de ${chauffeurName} ?`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: async () => {
            setError(null);
            setMessage(null);
            try {
              const res = await fetch(
                `${API_BASE_URL}/api/dispatcher/tour/${encodeURIComponent(chauffeurName)}?date=${date}`,
                {
                  method: "DELETE",
                  headers: { Authorization: `Bearer ${authToken}` },
                }
              );
              
              if (res.ok) {
                setMessage(`✅ Tournées de ${chauffeurName} supprimées`);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                loadSummary();
              } else {
                const data = await res.json();
                setError(data.message || "Erreur suppression");
              }
            } catch (e: any) {
              setError(`Erreur réseau: ${e.message || 'Connexion impossible'}`);
            }
          },
        },
      ]
    );
  };

  // Fonction d'export
  const exportChauffeur = async (chauffeurName: string, type: 'all' | 'gofo' | 'cainiao') => {
    if (!authToken) {
      setError("Non connecté");
      return;
    }

    try {
      setMessage(`📥 Téléchargement en cours...`);
      
      // Construire l'URL
      let url = `${API_BASE_URL}/api/mutualized/driver/${encodeURIComponent(chauffeurName)}/export?date=${date}`;
      if (type !== 'all') {
        url += `&source=${type}`;
      }
      
      // Télécharger le fichier
      const filename = `${chauffeurName}_${type === 'all' ? 'mutualisé' : type}_${date}.xlsx`;
      const fileUri = FileSystem.documentDirectory + filename;
      
      const downloadResult = await FileSystem.downloadAsync(
        url,
        fileUri,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        }
      );
      
      if (downloadResult.status !== 200) {
        setError(`Erreur téléchargement (${downloadResult.status})`);
        setMessage(null);
        return;
      }
      
      // Vérifier si le partage est disponible
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        setError("Partage non disponible sur cet appareil");
        setMessage(null);
        return;
      }
      
      // Partager le fichier
      await Sharing.shareAsync(downloadResult.uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: `Export ${chauffeurName}`,
      });
      
      setMessage(`✅ ${filename} exporté`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
    } catch (e: any) {
      console.error("Erreur export:", e);
      setError(`Erreur: ${e.message || 'Export impossible'}`);
      setMessage(null);
    }
  };

  // Séparer les chauffeurs par type
  const mutualized = summary.filter(ch => ch.gofo.count > 0 && ch.cainiao.count > 0);
  const gofoOnly = summary.filter(ch => ch.gofo.count > 0 && ch.cainiao.count === 0);
  const caniaoOnly = summary.filter(ch => ch.gofo.count === 0 && ch.cainiao.count > 0);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {/* Header */}
        <Text style={[styles.title, { marginBottom: 8 }]}>🚀 Import & Tournées</Text>
        
        {/* Sélecteur de date */}
        <TouchableOpacity
          onPress={() => setShowDatePicker(true)}
          style={{
            backgroundColor: theme.Colors.surface,
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderWidth: 1,
            borderColor: theme.Colors.subtleBorder,
          }}
        >
          <Text style={{ color: theme.Colors.text, fontSize: 16 }}>
            📅 {formatDateToFrench(date)}
          </Text>
          <Text style={{ color: theme.Colors.primary }}>Changer</Text>
        </TouchableOpacity>

        {showDatePicker && (
          <DateTimePicker
            value={internalDate}
            mode="date"
            display="default"
            onChange={onDateChange}
          />
        )}

        {/* Stats globales */}
        <View style={{
          flexDirection: 'row',
          justifyContent: 'space-around',
          backgroundColor: theme.Colors.surface,
          padding: 16,
          borderRadius: 12,
          marginBottom: 16,
          borderWidth: 1,
          borderColor: theme.Colors.subtleBorder,
        }}>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: '#f59e0b', fontSize: 24, fontWeight: 'bold' }}>{totals.gofo}</Text>
            <Text style={{ color: theme.Colors.textMuted, fontSize: 12 }}>Gofo</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: '#3b82f6', fontSize: 24, fontWeight: 'bold' }}>{totals.cainiao}</Text>
            <Text style={{ color: theme.Colors.textMuted, fontSize: 12 }}>Cainiao</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: theme.Colors.success, fontSize: 24, fontWeight: 'bold' }}>{totals.total}</Text>
            <Text style={{ color: theme.Colors.textMuted, fontSize: 12 }}>Total</Text>
          </View>
        </View>

        {/* Zone d'import */}
        <View style={{
          backgroundColor: theme.Colors.surface,
          padding: 16,
          borderRadius: 12,
          marginBottom: 16,
          borderWidth: 1,
          borderColor: theme.Colors.subtleBorder,
        }}>
          <Text style={{ color: theme.Colors.text, fontSize: 16, fontWeight: 'bold', marginBottom: 12 }}>
            📁 Importer des fichiers
          </Text>
          
          {/* Liste des fichiers sélectionnés */}
          {files.length > 0 && (
            <View style={{ marginBottom: 12 }}>
              {files.map((f, i) => (
                <View key={i} style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: theme.Colors.primarySoft,
                  padding: 10,
                  borderRadius: 8,
                  marginBottom: 6,
                }}>
                  <Text style={{ color: theme.Colors.text, flex: 1, fontSize: 13 }} numberOfLines={1}>
                    📄 {f.name}
                  </Text>
                  <TouchableOpacity onPress={() => removeFile(i)}>
                    <Text style={{ color: theme.Colors.danger, fontSize: 18, paddingHorizontal: 8 }}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
          
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={pickFiles}
              style={{
                flex: 1,
                backgroundColor: theme.Colors.primary,
                padding: 14,
                borderRadius: 8,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '600' }}>+ Ajouter fichiers</Text>
            </TouchableOpacity>
            
            {files.length > 0 && (
              <TouchableOpacity
                onPress={importFiles}
                disabled={importing}
                style={{
                  flex: 1,
                  backgroundColor: theme.Colors.success,
                  padding: 14,
                  borderRadius: 8,
                  alignItems: 'center',
                  opacity: importing ? 0.6 : 1,
                }}
              >
                {importing ? (
                  <Text style={{ color: '#fff', fontWeight: '600' }}>
                    {importProgress.current}/{importProgress.total}...
                  </Text>
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '600' }}>🚀 Importer</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Messages */}
        {message && (
          <Text style={{ color: theme.Colors.success, marginBottom: 12, textAlign: 'center', fontWeight: '600' }}>{message}</Text>
        )}
        {error && (
          <Text style={{ color: theme.Colors.danger, marginBottom: 12, textAlign: 'center' }}>{error}</Text>
        )}

        {/* Bouton supprimer tout */}
        {totals.total > 0 && (
          <TouchableOpacity
            onPress={deleteAllTours}
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              borderWidth: 1,
              borderColor: theme.Colors.danger,
              padding: 12,
              borderRadius: 8,
              alignItems: 'center',
              marginBottom: 16,
            }}
          >
            <Text style={{ color: theme.Colors.danger, fontWeight: '600' }}>🗑️ Supprimer tout</Text>
          </TouchableOpacity>
        )}

        {loadingSummary ? (
          <ActivityIndicator color={theme.Colors.primary} />
        ) : (
          <>
            {/* Section Mutualisé */}
            {mutualized.length > 0 && (
              <View style={{ marginBottom: 20 }}>
                <Text style={{ color: theme.Colors.success, fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>
                  🟢 Mutualisé ({mutualized.length})
                </Text>
                {mutualized.map((ch, i) => (
                  <ChauffeurCard 
                    key={i} 
                    chauffeur={ch} 
                    onDelete={() => deleteChauffeur(ch.chauffeur)}
                    onExport={(type) => exportChauffeur(ch.chauffeur, type)}
                  />
                ))}
              </View>
            )}

            {/* Section Gofo uniquement */}
            {gofoOnly.length > 0 && (
              <View style={{ marginBottom: 20 }}>
                <Text style={{ color: theme.Colors.warning, fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>
                  🟡 Gofo uniquement ({gofoOnly.length})
                </Text>
                {gofoOnly.map((ch, i) => (
                  <ChauffeurCard 
                    key={i} 
                    chauffeur={ch} 
                    onDelete={() => deleteChauffeur(ch.chauffeur)}
                    onExport={(type) => exportChauffeur(ch.chauffeur, type)}
                  />
                ))}
              </View>
            )}

            {/* Section Cainiao uniquement */}
            {caniaoOnly.length > 0 && (
              <View style={{ marginBottom: 20 }}>
                <Text style={{ color: theme.Colors.primary, fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>
                  🔵 Cainiao uniquement ({caniaoOnly.length})
                </Text>
                {caniaoOnly.map((ch, i) => (
                  <ChauffeurCard 
                    key={i} 
                    chauffeur={ch} 
                    onDelete={() => deleteChauffeur(ch.chauffeur)}
                    onExport={(type) => exportChauffeur(ch.chauffeur, type)}
                  />
                ))}
              </View>
            )}

            {summary.length === 0 && (
              <Text style={{ color: theme.Colors.textMuted, textAlign: 'center', marginTop: 20 }}>
                Aucune tournée pour cette date
              </Text>
            )}
          </>
        )}

        {/* Bouton retour */}
        <AppButton
          title="← Retour"
          onPress={onBack}
          style={{ backgroundColor: theme.Colors.muted, marginTop: 20 }}
        />
      </ScrollView>

      {/* Modal chauffeurs inconnus */}
      <RNModal visible={showUnknownModal} animationType="slide" transparent>
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'center',
          padding: 20,
        }}>
          <View style={{
            backgroundColor: theme.Colors.surface,
            borderRadius: 16,
            padding: 20,
            maxHeight: '80%',
            borderWidth: 1,
            borderColor: theme.Colors.subtleBorder,
          }}>
            <Text style={{ color: theme.Colors.text, fontSize: 18, fontWeight: 'bold', marginBottom: 16 }}>
              👤 Chauffeurs inconnus
            </Text>
            
            <ScrollView style={{ maxHeight: 400 }}>
              {unknownChauffeurs.map((ch, i) => (
                <View key={i} style={{
                  backgroundColor: theme.Colors.surfaceMuted,
                  padding: 12,
                  borderRadius: 8,
                  marginBottom: 12,
                }}>
                  <Text style={{ color: theme.Colors.text, fontWeight: 'bold', marginBottom: 4 }}>
                    🚚 {ch.name}
                  </Text>
                  <Text style={{ color: theme.Colors.textMuted, fontSize: 12, marginBottom: 8 }}>
                    {ch.colisCount} colis
                    {ch.stats.gofo > 0 && ` • ${ch.stats.gofo} Gofo`}
                    {ch.stats.cainiao > 0 && ` • ${ch.stats.cainiao} Cainiao`}
                  </Text>
                  
                  <View style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: 6,
                  }}>
                    {availableST.map((st, j) => (
                      <TouchableOpacity
                        key={j}
                        onPress={() => setAssignments(prev => ({ ...prev, [ch.name]: st }))}
                        style={{
                          backgroundColor: assignments[ch.name] === st ? theme.Colors.primary : theme.Colors.primarySoft,
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 20,
                        }}
                      >
                        <Text style={{ color: assignments[ch.name] === st ? '#fff' : theme.Colors.primary, fontSize: 13 }}>{st}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>
            
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <TouchableOpacity
                onPress={() => {
                  setShowUnknownModal(false);
                  setPendingFiles([]);
                  setAssignments({});
                }}
                style={{
                  flex: 1,
                  padding: 14,
                  borderRadius: 8,
                  backgroundColor: theme.Colors.surfaceMuted,
                  alignItems: 'center',
                  borderWidth: 1,
                  borderColor: theme.Colors.subtleBorder,
                }}
              >
                <Text style={{ color: theme.Colors.text }}>Annuler</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                onPress={handleAssignAndRetry}
                style={{
                  flex: 1,
                  padding: 14,
                  borderRadius: 8,
                  backgroundColor: theme.Colors.success,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>Valider</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </RNModal>
    </View>
  );
}

// ===============
// DISPATCHER_IMPORT_UNIFIE (version pour sous-traitant)
// ===============

interface DispatcherImportUnifieProps {
  onBack: () => void;
  authToken: string | null;
  currentUser: User | null;
}

function DispatcherImportUnifieScreen({ onBack, authToken, currentUser }: DispatcherImportUnifieProps) {
  const [date, setDate] = useState(getTodayDateString());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [internalDate, setInternalDate] = useState(parseDateString(date));
  
  const [files, setFiles] = useState<DocumentPicker.DocumentPickerAsset[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  
  const [summary, setSummary] = useState<ChauffeurSummary[]>([]);
  const [totals, setTotals] = useState({ gofo: 0, cainiao: 0, total: 0 });
  const [loadingSummary, setLoadingSummary] = useState(false);
  
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sousTraitantName = currentUser?.sousTraitantName || '';

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => backHandler.remove();
  }, [onBack]);

  useEffect(() => {
    setInternalDate(parseDateString(date));
  }, [date]);

  useEffect(() => {
    loadSummary();
  }, [date, authToken]);

  const onDateChange = (_event: any, selected?: Date) => {
    setShowDatePicker(false);
    if (selected) {
      setInternalDate(selected);
      const y = selected.getFullYear();
      const m = String(selected.getMonth() + 1).padStart(2, '0');
      const d = String(selected.getDate()).padStart(2, '0');
      setDate(`${y}-${m}-${d}`);
    }
  };

  const loadSummary = async () => {
    if (!authToken || !date) return;
    
    setLoadingSummary(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/chauffeurs/summary/${date}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      
      if (res.ok) {
        const data = await res.json();
        setSummary(data.chauffeurs || []);
        setTotals(data.totals || { gofo: 0, cainiao: 0, total: 0 });
      } else {
        setSummary([]);
        setTotals({ gofo: 0, cainiao: 0, total: 0 });
      }
    } catch (e) {
      console.error("Erreur chargement summary:", e);
      setSummary([]);
      setTotals({ gofo: 0, cainiao: 0, total: 0 });
    } finally {
      setLoadingSummary(false);
    }
  };

  const pickFiles = async () => {
    setMessage(null);
    setError(null);
    
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
      ],
      multiple: true,
      copyToCacheDirectory: true,
    });

    if (result.canceled) return;
    setFiles(prev => [...prev, ...result.assets]);
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const importFiles = async () => {
    if (!authToken || files.length === 0) return;
    
    setImporting(true);
    setError(null);
    setMessage(null);
    setImportProgress({ current: 0, total: files.length });
    
    let successCount = 0;
    let totalColis = 0;
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setImportProgress({ current: i + 1, total: files.length });
      
      try {
        const formData = new FormData();
        formData.append('date', date);
        formData.append('sousTraitantName', sousTraitantName);
        formData.append('file', {
          uri: file.uri,
          name: file.name || 'file',
          type: file.mimeType || 'application/octet-stream',
        } as any);
        
        const res = await fetch(`${API_BASE_URL}/api/import/unified`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
          body: formData,
        });
        
        if (res.ok) {
          const data = await res.json();
          successCount++;
          totalColis += data.totalColis || 0;
        }
      } catch (e) {
        console.error(`Erreur import ${file.name}:`, e);
      }
    }
    
    setImporting(false);
    setFiles([]);
    
    if (successCount > 0) {
      setMessage(`✅ ${successCount} fichier(s) importé(s) - ${totalColis} colis`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      loadSummary();
    } else {
      setError("Aucun fichier importé avec succès");
    }
  };

  const deleteChauffeur = (chauffeurName: string) => {
    Alert.alert(
      "Supprimer",
      `Supprimer les tournées de ${chauffeurName} ?`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: async () => {
            setError(null);
            setMessage(null);
            try {
              const res = await fetch(
                `${API_BASE_URL}/api/dispatcher/tour/${encodeURIComponent(chauffeurName)}?date=${date}`,
                {
                  method: "DELETE",
                  headers: { Authorization: `Bearer ${authToken}` },
                }
              );
              
              if (res.ok) {
                setMessage(`✅ Tournées de ${chauffeurName} supprimées`);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                loadSummary();
              } else {
                const data = await res.json();
                setError(data.message || "Erreur suppression");
              }
            } catch (e: any) {
              setError(`Erreur réseau`);
            }
          },
        },
      ]
    );
  };

  const exportChauffeur = async (chauffeurName: string, type: 'all' | 'gofo' | 'cainiao') => {
    if (!authToken) return;

    try {
      setMessage(`📥 Téléchargement...`);
      
      let url = `${API_BASE_URL}/api/mutualized/driver/${encodeURIComponent(chauffeurName)}/export?date=${date}`;
      if (type !== 'all') url += `&source=${type}`;
      
      const filename = `${chauffeurName}_${type === 'all' ? 'mutualisé' : type}_${date}.xlsx`;
      const fileUri = FileSystem.documentDirectory + filename;
      
      const downloadResult = await FileSystem.downloadAsync(url, fileUri, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      
      if (downloadResult.status !== 200) {
        setError(`Erreur téléchargement`);
        setMessage(null);
        return;
      }
      
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(downloadResult.uri, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          dialogTitle: `Export ${chauffeurName}`,
        });
      }
      
      setMessage(`✅ ${filename} exporté`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setError(`Erreur export`);
      setMessage(null);
    }
  };

  // Séparer les chauffeurs par type
  const mutualized = summary.filter(ch => ch.gofo.count > 0 && ch.cainiao.count > 0);
  const gofoOnly = summary.filter(ch => ch.gofo.count > 0 && ch.cainiao.count === 0);
  const caniaoOnly = summary.filter(ch => ch.gofo.count === 0 && ch.cainiao.count > 0);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={[styles.title, { marginBottom: 8 }]}>🚀 Import & Tournées</Text>
        <Text style={{ color: theme.Colors.textMuted, marginBottom: 16 }}>
          {sousTraitantName}
        </Text>
        
        {/* Sélecteur de date */}
        <TouchableOpacity
          onPress={() => setShowDatePicker(true)}
          style={{
            backgroundColor: theme.Colors.surface,
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderWidth: 1,
            borderColor: theme.Colors.subtleBorder,
          }}
        >
          <Text style={{ color: theme.Colors.text, fontSize: 16 }}>
            📅 {formatDateToFrench(date)}
          </Text>
          <Text style={{ color: theme.Colors.primary }}>Changer</Text>
        </TouchableOpacity>

        {showDatePicker && (
          <DateTimePicker
            value={internalDate}
            mode="date"
            display="default"
            onChange={onDateChange}
          />
        )}

        {/* Stats globales */}
        <View style={{
          flexDirection: 'row',
          backgroundColor: theme.Colors.surface,
          borderRadius: 10,
          padding: 16,
          marginBottom: 16,
          borderWidth: 1,
          borderColor: theme.Colors.subtleBorder,
        }}>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: '#f59e0b', fontSize: 24, fontWeight: 'bold' }}>{totals.gofo}</Text>
            <Text style={{ color: theme.Colors.textMuted, fontSize: 12 }}>Gofo</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: theme.Colors.primary, fontSize: 24, fontWeight: 'bold' }}>{totals.cainiao}</Text>
            <Text style={{ color: theme.Colors.textMuted, fontSize: 12 }}>Cainiao</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: theme.Colors.success, fontSize: 24, fontWeight: 'bold' }}>{totals.total}</Text>
            <Text style={{ color: theme.Colors.textMuted, fontSize: 12 }}>Total</Text>
          </View>
        </View>

        {/* Import de fichiers */}
        <View style={{
          backgroundColor: theme.Colors.surface,
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
          borderWidth: 1,
          borderColor: theme.Colors.subtleBorder,
        }}>
          <Text style={{ color: theme.Colors.text, fontWeight: 'bold', marginBottom: 12 }}>
            📁 Importer des fichiers
          </Text>
          
          <TouchableOpacity
            onPress={pickFiles}
            disabled={importing}
            style={{
              backgroundColor: theme.Colors.primary,
              padding: 14,
              borderRadius: 8,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>+ Ajouter fichiers</Text>
          </TouchableOpacity>

          {files.length > 0 && (
            <View style={{ marginTop: 12 }}>
              {files.map((file, index) => (
                <View key={index} style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: theme.Colors.surfaceMuted,
                  padding: 10,
                  borderRadius: 6,
                  marginBottom: 6,
                }}>
                  <Text style={{ flex: 1, color: theme.Colors.text, fontSize: 13 }} numberOfLines={1}>
                    {file.name}
                  </Text>
                  <TouchableOpacity onPress={() => removeFile(index)}>
                    <Text style={{ color: theme.Colors.danger }}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
              
              <TouchableOpacity
                onPress={importFiles}
                disabled={importing}
                style={{
                  backgroundColor: theme.Colors.success,
                  padding: 14,
                  borderRadius: 8,
                  alignItems: 'center',
                  marginTop: 8,
                  opacity: importing ? 0.6 : 1,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>
                  {importing 
                    ? `Import ${importProgress.current}/${importProgress.total}...` 
                    : `🚀 Importer (${files.length} fichier${files.length > 1 ? 's' : ''})`
                  }
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Messages */}
        {message && (
          <Text style={{ color: theme.Colors.success, textAlign: 'center', marginBottom: 12 }}>{message}</Text>
        )}
        {error && (
          <Text style={{ color: theme.Colors.danger, textAlign: 'center', marginBottom: 12 }}>{error}</Text>
        )}

        {/* Liste des chauffeurs */}
        {loadingSummary ? (
          <ActivityIndicator color={theme.Colors.primary} />
        ) : (
          <>
            {mutualized.length > 0 && (
              <View style={{ marginBottom: 20 }}>
                <Text style={{ color: theme.Colors.success, fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>
                  🟢 Mutualisé ({mutualized.length})
                </Text>
                {mutualized.map((ch, i) => (
                  <ChauffeurCard 
                    key={i} 
                    chauffeur={ch} 
                    onDelete={() => deleteChauffeur(ch.chauffeur)}
                    onExport={(type) => exportChauffeur(ch.chauffeur, type)}
                  />
                ))}
              </View>
            )}

            {gofoOnly.length > 0 && (
              <View style={{ marginBottom: 20 }}>
                <Text style={{ color: '#f59e0b', fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>
                  🟡 Gofo uniquement ({gofoOnly.length})
                </Text>
                {gofoOnly.map((ch, i) => (
                  <ChauffeurCard 
                    key={i} 
                    chauffeur={ch} 
                    onDelete={() => deleteChauffeur(ch.chauffeur)}
                    onExport={(type) => exportChauffeur(ch.chauffeur, type)}
                  />
                ))}
              </View>
            )}

            {caniaoOnly.length > 0 && (
              <View style={{ marginBottom: 20 }}>
                <Text style={{ color: theme.Colors.primary, fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>
                  🔵 Cainiao uniquement ({caniaoOnly.length})
                </Text>
                {caniaoOnly.map((ch, i) => (
                  <ChauffeurCard 
                    key={i} 
                    chauffeur={ch} 
                    onDelete={() => deleteChauffeur(ch.chauffeur)}
                    onExport={(type) => exportChauffeur(ch.chauffeur, type)}
                  />
                ))}
              </View>
            )}

            {summary.length === 0 && (
              <Text style={{ color: theme.Colors.textMuted, textAlign: 'center', marginTop: 20 }}>
                Aucune tournée pour cette date
              </Text>
            )}
          </>
        )}

        {/* Bouton retour */}
        <TouchableOpacity
          onPress={onBack}
          style={{
            backgroundColor: theme.Colors.muted,
            padding: 14,
            borderRadius: 10,
            alignItems: 'center',
            marginTop: 16,
          }}
        >
          <Text style={{ color: '#fff', fontWeight: 'bold' }}>← Retour</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// Composant carte chauffeur
function ChauffeurCard({ 
  chauffeur, 
  onDelete,
  onExport 
}: { 
  chauffeur: ChauffeurSummary; 
  onDelete: () => void;
  onExport: (type: 'all' | 'gofo' | 'cainiao') => void;
}) {
  const [showExportMenu, setShowExportMenu] = useState(false);
  
  return (
    <View style={{
      backgroundColor: theme.Colors.surface,
      padding: 12,
      borderRadius: 10,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: theme.Colors.subtleBorder,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.Colors.text, fontWeight: 'bold', fontSize: 15 }}>
            {chauffeur.chauffeur}
          </Text>
          <Text style={{ color: theme.Colors.textMuted, fontSize: 12 }}>
            {chauffeur.sousTraitant}
          </Text>
        </View>
        
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {chauffeur.gofo.count > 0 && (
            <View style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
              <Text style={{ color: '#d97706', fontSize: 13, fontWeight: 'bold' }}>{chauffeur.gofo.count}</Text>
            </View>
          )}
          {chauffeur.cainiao.count > 0 && (
            <View style={{ backgroundColor: 'rgba(37, 99, 235, 0.15)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
              <Text style={{ color: theme.Colors.primary, fontSize: 13, fontWeight: 'bold' }}>{chauffeur.cainiao.count}</Text>
            </View>
          )}
          <Text style={{ color: theme.Colors.success, fontWeight: 'bold', marginLeft: 4 }}>{chauffeur.total}</Text>
          
          <TouchableOpacity onPress={() => setShowExportMenu(!showExportMenu)} style={{ padding: 6 }}>
            <Text style={{ color: theme.Colors.primary, fontSize: 16 }}>📥</Text>
          </TouchableOpacity>
          
          <TouchableOpacity onPress={onDelete} style={{ padding: 6 }}>
            <Text style={{ color: theme.Colors.danger, fontSize: 16 }}>🗑️</Text>
          </TouchableOpacity>
        </View>
      </View>
      
      {/* Menu d'export */}
      {showExportMenu && (
        <View style={{ 
          flexDirection: 'row', 
          gap: 8, 
          marginTop: 10,
          paddingTop: 10,
          borderTopWidth: 1,
          borderTopColor: theme.Colors.subtleBorder,
        }}>
          {chauffeur.gofo.count > 0 && chauffeur.cainiao.count > 0 && (
            <TouchableOpacity
              onPress={() => { onExport('all'); setShowExportMenu(false); }}
              style={{
                flex: 1,
                backgroundColor: theme.Colors.success,
                padding: 8,
                borderRadius: 6,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>📥 Mutualisé</Text>
            </TouchableOpacity>
          )}
          {chauffeur.gofo.count > 0 && (
            <TouchableOpacity
              onPress={() => { onExport('gofo'); setShowExportMenu(false); }}
              style={{
                flex: 1,
                backgroundColor: '#f59e0b',
                padding: 8,
                borderRadius: 6,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>📥 Gofo</Text>
            </TouchableOpacity>
          )}
          {chauffeur.cainiao.count > 0 && (
            <TouchableOpacity
              onPress={() => { onExport('cainiao'); setShowExportMenu(false); }}
              style={{
                flex: 1,
                backgroundColor: theme.Colors.primary,
                padding: 8,
                borderRadius: 6,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>📥 Cainiao</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}


// ===============
// ADMIN_HOME
// ===============

type AdminHomeProps = {
  onBack: () => void;
  onGoToImport: () => void;
  onGoToUsers: () => void;
};

function AdminHomeScreen({ onBack, onGoToImport, onGoToUsers }: AdminHomeProps) {
  // Gestion du bouton retour Android
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });

    return () => backHandler.remove();
  }, [onBack]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Espace administrateur</Text>
      <View style={{ marginBottom: 16 }}>
        <AppButton 
          title="🚀 Import & Tournées" 
          onPress={onGoToImport} 
          style={{ backgroundColor: '#22c55e' }}
        />
      </View>
      <View style={{ marginBottom: 16 }}>
        <AppButton title="👤 Gestion des utilisateurs" onPress={onGoToUsers} />
      </View>
      <AppButton title="← Retour" onPress={onBack} style={{ backgroundColor: "#E5E7EB", borderWidth: 1, borderColor: "#6B7280" }} />
    </View>
  );
}

// ===============
// ADMIN_TOURS
// ===============

interface AdminToursProps {
  onBack: () => void;
  authToken: string | null;
}

function AdminToursScreen({ onBack, authToken }: AdminToursProps) {
  const [date, setDate] = useState<string>(getTodayDateString());
  const [tours, setTours] = useState<BackendTour[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  
  // Sélecteurs uniques pour date et sous-traitant (affect import et liste)
  const [availableSousTraitants, setAvailableSousTraitants] = useState<string[]>([]);
  const [selectedSousTraitant, setSelectedSousTraitant] = useState<string>("TOUS");
  const [showSousTraitantPicker, setShowSousTraitantPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [internalDate, setInternalDate] = useState<Date>(parseDateString(getTodayDateString()));
  
  // Import de tournée
  const [importFile, setImportFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // NOUVEAUX ÉTATS POUR CANIAO
  const [canaioTours, setCanaioTours] = useState<BackendTour[]>([]);
  const [canaioLoading, setCanaioLoading] = useState(false);
  const [canaioMessage, setCanaioMessage] = useState<string | null>(null);
  const [canaioError, setCanaioError] = useState<string | null>(null);

  useEffect(() => {
    if (date) {
      setInternalDate(parseDateString(date));
    }
  }, [date]);
  
  // Charger la liste des sous-traitants
  useEffect(() => {
    const fetchSousTraitants = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/users`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });
        
        if (res.ok) {
          const users = await res.json();
          const sousTraitants = users
            .map((u: User) => u.sousTraitantName)
            .filter((name: string | null) => name != null) as string[];
          const uniqueSousTraitants = Array.from(new Set(sousTraitants));
          setAvailableSousTraitants(uniqueSousTraitants);
        }
      } catch (e) {
        console.error("Erreur lors du chargement des sous-traitants:", e);
      }
    };
    
    fetchSousTraitants();
  }, [authToken]);

  // Gestion du bouton retour Android
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });

    return () => backHandler.remove();
  }, [onBack]);

  const openDatePicker = () => {
    setShowDatePicker(true);
  };

  const onDateChange = (_event: any, selected?: Date) => {
    setShowDatePicker(false);
    if (selected) {
      setInternalDate(selected);
      const year = selected.getFullYear();
      const month = String(selected.getMonth() + 1).padStart(2, "0");
      const day = String(selected.getDate()).padStart(2, "0");
      const dateString = `${year}-${month}-${day}`;
      setDate(dateString);
      loadTours(dateString, selectedSousTraitant);
    }
  };

  const loadTours = async (filterDate: string | null, filterSousTraitant: string = "TOUS", silent: boolean = false) => {
    if (!authToken) {
      setError("Vous n'êtes pas connecté (token manquant).");
      setTours([]);
      return;
    }

    setLoading(true);
    if (!silent) {
      setError(null);
      setMessage(null);
    }
    setTours([]);

    try {
      let url = `${API_BASE_URL}/api/tours`;
      const params = [];
      if (filterDate) {
        params.push(`date=${encodeURIComponent(filterDate)}`);
      }
      if (filterSousTraitant && filterSousTraitant !== "TOUS") {
        params.push(`sousTraitant=${encodeURIComponent(filterSousTraitant)}`);
      }
      if (params.length > 0) {
        url += `?${params.join('&')}`;
      }

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      if (!res.ok) {
        const text = await res.text();
        setError(`Erreur lors du chargement des tournées : ${text}`);
        return;
      }

      const data = await res.json();
      // Filtrer les tournées CANIAO - elles s'affichent uniquement dans la section CANIAO
      const nonCanaioTours = (data.tours || []).filter((t: BackendTour) => !t.isCaniao);
      setTours(nonCanaioTours);
      // Effacer les erreurs précédentes si le chargement réussit
      setError(null);

      if (nonCanaioTours.length === 0) {
        setMessage("Aucune tournée trouvée.");
      }
    } catch (e: any) {
      // Ne pas afficher d'erreur si c'est un rechargement silencieux (après import/suppression)
      if (!silent) {
        setError(
          "Impossible de contacter le serveur. Vérifie qu'il est lancé et que le téléphone est sur le même Wi-Fi."
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (tour: BackendTour) => {
    if (!authToken) {
      setError("Vous n'êtes pas connecté (token manquant).");
      return;
    }

    Alert.alert(
      "Confirmation",
      `Supprimer la tournée #${tour.id} (${tour.tourneeName}) et ses ${tour.colisCount} colis ?`,
      [
        {
          text: "Annuler",
          style: "cancel",
        },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: async () => {
            try {
              setLoading(true);
              setError(null);
              setMessage(null);

              const res = await fetch(`${API_BASE_URL}/api/tours/${tour.id}`, {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${authToken}`,
                },
              });

              if (!res.ok) {
                const text = await res.text();
                setError(`Erreur lors de la suppression : ${text}`);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                return;
              }

              const data = await res.json();
              setMessage(
                `Tournée supprimée : ${data.removedTour.tourneeName} (${data.removedColis} colis supprimés)`
              );
              setError(null);

              // Retirer immédiatement la tournée de la liste locale
              setTours(prevTours => prevTours.filter(t => t.id !== tour.id));

              // Feedback haptique de succès
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

              // Recharger ensuite pour synchroniser avec le serveur
              loadTours(date || null, selectedSousTraitant, true);
            } catch (e: any) {
              setError(
                "Impossible de contacter le serveur. Vérifie qu'il est lancé et que le téléphone est sur le même Wi-Fi."
              );
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  useEffect(() => {
    // Petit délai pour laisser le backend démarrer si nécessaire
    const timer = setTimeout(() => {
      loadTours(date || null, selectedSousTraitant);
    }, 300);
    
    return () => clearTimeout(timer);
  }, [selectedSousTraitant]);

  const pickImportFile = async () => {
    setImportMessage(null);
    setImportError(null);

    // Vérifier si un sous-traitant est sélectionné
    if (selectedSousTraitant === "TOUS" || !selectedSousTraitant) {
      Alert.alert(
        "Sous-traitant requis",
        "Merci de sélectionner un sous-traitant spécifique avant d'importer une tournée.",
        [{ text: "OK", style: "default" }]
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"],
      copyToCacheDirectory: true,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    setImportFile(asset);
    
    setTimeout(() => handleImportTour(asset), 100);
  };

  const handleImportTour = async (fileToImport?: any) => {
    setImportMessage(null);
    setImportError(null);
    // Effacer aussi les messages de la liste pour éviter l'affichage persistant
    setError(null);
    setMessage(null);

    if (!authToken) {
      setImportError("Vous n'êtes pas connecté (token manquant).");
      return;
    }

    const fileToUse = fileToImport || importFile;

    if (!date || !fileToUse) {
      setImportError("Veuillez sélectionner une date et un fichier.");
      return;
    }

    // Sous-traitant requis pour l'import, même pour ADMIN
    if (!selectedSousTraitant || selectedSousTraitant === "TOUS") {
      setImportError("Veuillez sélectionner un sous-traitant spécifique avant d'importer.");
      return;
    }

    try {
      setImportLoading(true);

      const formData = new FormData();
      formData.append("date", date);
      formData.append("sousTraitantName", selectedSousTraitant);
      formData.append("file", {
        uri: fileToUse.uri,
        name: fileToUse.name ?? "tournee.txt",
        type: fileToUse.mimeType ?? "text/plain",
      } as any);

      const res = await fetch(`${API_BASE_URL}/api/tours/import`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text();
        setImportError(`Erreur lors de l'import : ${text}`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      const data = await res.json();
      setImportMessage(
        `Tournée importée : ${data.tour.tourneeName} (${data.tour.colisCount} colis)`
      );
      setImportError(null);

      // Ajouter immédiatement la nouvelle tournée à la liste locale
      setTours(prevTours => [data.tour, ...prevTours]);

      // Feedback haptique de succès
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      setImportFile(null);
      // Recharger ensuite pour synchroniser avec le serveur
      loadTours(date || null, selectedSousTraitant, true);
      setError(null);
    } catch (e: any) {
      setImportError(
        "Impossible de contacter le serveur. Vérifie qu'il est lancé et que le téléphone est sur le même Wi-Fi."
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setImportLoading(false);
    }
  };

  const handleDownload = (tour: BackendTour) => {
    if (!authToken) {
      Alert.alert("Erreur", "Vous n'êtes pas connecté (token manquant).");
      return;
    }

    const url = `${API_BASE_URL}/api/dispatcher/tours/${tour.id}/download?token=${encodeURIComponent(
      authToken
    )}`;

    Linking.openURL(url).catch(() => {
      Alert.alert("Erreur", "Impossible d'ouvrir le lien de téléchargement.");
    });
  };

  // FONCTIONS CANIAO
  const loadCanaioTours = async (filterDate: string | null, silent: boolean = false) => {
    if (!authToken) {
      setCanaioError("Vous n'êtes pas connecté (token manquant).");
      setCanaioTours([]);
      return;
    }

    setCanaioLoading(true);
    if (!silent) {
      setCanaioError(null);
      setCanaioMessage(null);
    }
    setCanaioTours([]);

    try {
      // Ne pas filtrer les tournées CANIAO par date - afficher toutes les tournées CANIAO
      let url = `${API_BASE_URL}/api/tours?isCaniaoOnly=true`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const text = await res.text();
        setCanaioError(`Erreur lors du chargement des tournées CANIAO : ${text}`);
        return;
      }

      const data = await res.json();
      // Filtrer côté client pour ne garder que les tournées du jour sélectionné
      if (filterDate) {
        const filtered = (data.tours || []).filter((t: BackendTour) => t.date === filterDate);
        setCanaioTours(filtered);
      } else {
        setCanaioTours(data.tours || []);
      }
      setCanaioError(null);

      if ((data.tours || []).length === 0) {
        setCanaioMessage("Aucune tournée CANIAO trouvée.");
      }
    } catch (e: any) {
      if (!silent) {
        setCanaioError(
          "Impossible de contacter le serveur. Vérifie qu'il est lancé et que le téléphone est sur le même Wi-Fi."
        );
      }
    } finally {
      setCanaioLoading(false);
    }
  };

  const pickCanaioFile = async () => {
    setCanaioMessage(null);
    setCanaioError(null);

    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf"],
      copyToCacheDirectory: true,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    
    setTimeout(() => handleCanaioImport(asset), 100);
  };

  const handleCanaioImport = async (fileToImport: any) => {
    setCanaioMessage(null);
    setCanaioError(null);
    setError(null);
    setMessage(null);

    if (!authToken) {
      setCanaioError("Vous n'êtes pas connecté (token manquant).");
      return;
    }

    if (!date) {
      setCanaioError("Veuillez sélectionner une date.");
      return;
    }

    try {
      setCanaioLoading(true);

      const formData = new FormData();
      formData.append("date", date);
      formData.append("file", {
        uri: fileToImport.uri,
        name: fileToImport.name ?? "caniao.pdf",
        type: fileToImport.mimeType ?? "application/pdf",
      } as any);

      const res = await fetch(`${API_BASE_URL}/api/tours/caniao`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text();
        setCanaioError(`Erreur lors de l'import CANIAO : ${text}`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      const data = await res.json();
      const toursCount = data.tours.length;
      const totalColis = data.tours.reduce((sum: number, t: any) => sum + t.colisCount, 0);
      setCanaioMessage(
        `Import CANIAO réussi : ${toursCount} tournées créées (${totalColis} colis au total)`
      );
      setCanaioError(null);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Recharger les tournées CANIAO
      loadCanaioTours(date || null, true);
      // Recharger aussi les tournées normales si le filtre est sur TOUS
      if (selectedSousTraitant === "TOUS") {
        loadTours(date || null, selectedSousTraitant, true);
      }
    } catch (e: any) {
      setCanaioError(
        "Impossible de contacter le serveur. Vérifie qu'il est lancé et que le téléphone est sur le même Wi-Fi."
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setCanaioLoading(false);
    }
  };

  const handleCanaioDelete = (tour: BackendTour) => {
    if (!authToken) {
      setCanaioError("Vous n'êtes pas connecté (token manquant).");
      return;
    }

    Alert.alert(
      "Confirmation",
      `Supprimer la tournée CANIAO #${tour.id} (${tour.tourneeName}) et ses ${tour.colisCount} colis ?`,
      [
        {
          text: "Annuler",
          style: "cancel",
        },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: async () => {
            try {
              setCanaioLoading(true);
              setCanaioError(null);
              setCanaioMessage(null);

              const res = await fetch(`${API_BASE_URL}/api/tours/${tour.id}`, {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${authToken}`,
                },
              });

              if (!res.ok) {
                const text = await res.text();
                setCanaioError(`Erreur lors de la suppression : ${text}`);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                return;
              }

              const data = await res.json();
              setCanaioMessage(
                `Tournée CANIAO supprimée : ${data.removedTour.tourneeName} (${data.removedColis} colis supprimés)`
              );
              setCanaioError(null);

              // Retirer immédiatement la tournée de la liste locale
              setCanaioTours(prevTours => prevTours.filter(t => t.id !== tour.id));

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

              // Recharger ensuite pour synchroniser avec le serveur
              loadCanaioTours(date || null, true);
            } catch (e: any) {
              setCanaioError(
                "Impossible de contacter le serveur. Vérifie qu'il est lancé et que le téléphone est sur le même Wi-Fi."
              );
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            } finally {
              setCanaioLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleDeleteAllTours = () => {
    if (!authToken) {
      setError("Vous n'êtes pas connecté (token manquant).");
      return;
    }

    if (tours.length === 0) {
      Alert.alert("Info", "Aucune tournée à supprimer.");
      return;
    }

    const totalColis = tours.reduce((sum, t) => sum + (t.colisCount || 0), 0);

    Alert.alert(
      "⚠️ Confirmation",
      `Supprimer TOUTES les ${tours.length} tournées (${totalColis} colis au total) ?\n\nCette action est irréversible !`,
      [
        {
          text: "Annuler",
          style: "cancel",
        },
        {
          text: "Tout supprimer",
          style: "destructive",
          onPress: async () => {
            try {
              setLoading(true);
              setError(null);
              setMessage(null);

              let deletedCount = 0;
              let totalColisDeleted = 0;

              for (const tour of tours) {
                const res = await fetch(`${API_BASE_URL}/api/tours/${tour.id}`, {
                  method: "DELETE",
                  headers: {
                    Authorization: `Bearer ${authToken}`,
                  },
                });

                if (res.ok) {
                  const data = await res.json();
                  deletedCount++;
                  totalColisDeleted += data.removedColis || 0;
                }
              }

              setMessage(
                `✅ ${deletedCount} tournées supprimées (${totalColisDeleted} colis)`
              );
              setError(null);
              setTours([]);

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

              // Recharger pour synchroniser
              loadTours(date || null, selectedSousTraitant, true);
            } catch (e: any) {
              setError(
                "Impossible de contacter le serveur. Vérifie qu'il est lancé et que le téléphone est sur le même Wi-Fi."
              );
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleDeleteAllCanaioTours = () => {
    if (!authToken) {
      setCanaioError("Vous n'êtes pas connecté (token manquant).");
      return;
    }

    if (canaioTours.length === 0) {
      Alert.alert("Info", "Aucune tournée CANIAO à supprimer.");
      return;
    }

    const totalColis = canaioTours.reduce((sum, t) => sum + (t.colisCount || 0), 0);

    Alert.alert(
      "⚠️ Confirmation",
      `Supprimer TOUTES les ${canaioTours.length} tournées CANIAO (${totalColis} colis au total) ?\n\nCette action est irréversible !`,
      [
        {
          text: "Annuler",
          style: "cancel",
        },
        {
          text: "Tout supprimer",
          style: "destructive",
          onPress: async () => {
            try {
              setCanaioLoading(true);
              setCanaioError(null);
              setCanaioMessage(null);

              let deletedCount = 0;
              let totalColisDeleted = 0;

              for (const tour of canaioTours) {
                const res = await fetch(`${API_BASE_URL}/api/tours/${tour.id}`, {
                  method: "DELETE",
                  headers: {
                    Authorization: `Bearer ${authToken}`,
                  },
                });

                if (res.ok) {
                  const data = await res.json();
                  deletedCount++;
                  totalColisDeleted += data.removedColis || 0;
                }
              }

              setCanaioMessage(
                `✅ ${deletedCount} tournées CANIAO supprimées (${totalColisDeleted} colis)`
              );
              setCanaioError(null);
              setCanaioTours([]);

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

              // Recharger pour synchroniser
              loadCanaioTours(date || null, true);
            } catch (e: any) {
              setCanaioError(
                "Impossible de contacter le serveur. Vérifie qu'il est lancé et que le téléphone est sur le même Wi-Fi."
              );
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            } finally {
              setCanaioLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleRestoreDeleted = () => {
    if (!authToken) {
      setError("Vous n'êtes pas connecté (token manquant).");
      return;
    }

    if (!date) {
      Alert.alert("Info", "Veuillez d'abord sélectionner une date.");
      return;
    }

    Alert.alert(
      "♻️ Restaurer les tournées",
      `Restaurer les tournées supprimées du ${formatDateToFrench(date)} ?`,
      [
        {
          text: "Annuler",
          style: "cancel",
        },
        {
          text: "Restaurer",
          onPress: async () => {
            try {
              setLoading(true);
              setError(null);
              setMessage(null);

              const res = await fetch(`${API_BASE_URL}/api/dispatcher/tours/reset-all`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({ date, onlyDeleted: true }),
              });

              if (!res.ok) {
                const data = await res.json();
                setError(data.message || "Erreur lors de la restauration");
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                return;
              }

              const data = await res.json();
              setMessage(
                `✅ ${data.restoredTours || 0} tournée(s) restaurée(s) (${data.restoredColis || 0} colis)`
              );
              setError(null);

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

              // Recharger les tournées
              loadTours(date, selectedSousTraitant, true);
            } catch (e: any) {
              setError(
                "Impossible de contacter le serveur. Vérifie qu'il est lancé et que le téléphone est sur le même Wi-Fi."
              );
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  useEffect(() => {
    loadCanaioTours(date || null);
  }, [date]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>👨‍💼 Tableau de bord Administrateur</Text>
      
      {/* SECTION FILTRES GLOBAUX */}
      <View
        style={{
          backgroundColor: theme.Colors.primarySoft,
          borderLeftWidth: 4,
          borderLeftColor: theme.Colors.primary,
          borderRadius: 12,
          padding: theme.Spacing.md,
          marginBottom: theme.Spacing.lg,
        }}
      >
        <Text
          style={{
            fontSize: 14,
            fontWeight: "600",
            color: theme.Colors.text,
            marginBottom: theme.Spacing.md,
          }}
        >
          Filtres
        </Text>

        <View style={{ flexDirection: "row", gap: theme.Spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 12,
                color: theme.Colors.muted,
                marginBottom: theme.Spacing.xs,
                fontWeight: "500",
              }}
            >
              Date
            </Text>
            <TouchableOpacity onPress={openDatePicker}>
              <View
                style={{
                  backgroundColor: theme.Colors.surface,
                  borderWidth: 1,
                  borderColor: theme.Colors.subtleBorder,
                  borderRadius: 8,
                  paddingVertical: theme.Spacing.sm,
                  paddingHorizontal: theme.Spacing.sm,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "500" }}>
                  {formatDateToFrench(date)}
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 12,
                color: theme.Colors.muted,
                marginBottom: theme.Spacing.xs,
                fontWeight: "500",
              }}
            >
              Sous-traitant
            </Text>
            <TouchableOpacity onPress={() => setShowSousTraitantPicker(true)}>
              <View
                style={{
                  backgroundColor: theme.Colors.surface,
                  borderWidth: 1,
                  borderColor: theme.Colors.subtleBorder,
                  borderRadius: 8,
                  paddingVertical: theme.Spacing.sm,
                  paddingHorizontal: theme.Spacing.sm,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "500" }}>
                  {selectedSousTraitant === "TOUS"
                    ? "Tous"
                    : selectedSousTraitant}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {showDatePicker && (
        <DateTimePicker
          value={internalDate}
          mode="date"
          display="default"
          onChange={onDateChange}
        />
      )}
      
      <ModalView
        visible={showSousTraitantPicker}
        onRequestClose={() => setShowSousTraitantPicker(false)}
      >
        <View style={{ paddingBottom: theme.Spacing.lg }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.Spacing.md }}>
            <Text style={{ fontSize: theme.Typography.h2, fontWeight: "700" }}>Choisir un sous-traitant</Text>
            <TouchableOpacity onPress={() => setShowSousTraitantPicker(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={{ fontSize: 28, color: theme.Colors.muted }}>×</Text>
            </TouchableOpacity>
          </View>
          
          <ScrollView style={{ maxHeight: 300 }}>
            <TouchableOpacity
              onPress={() => {
                setSelectedSousTraitant("TOUS");
                setShowSousTraitantPicker(false);
              }}
              style={{
                padding: theme.Spacing.md,
                backgroundColor: selectedSousTraitant === "TOUS" ? theme.Colors.primary : theme.Colors.surface,
                borderRadius: 8,
                marginBottom: theme.Spacing.sm,
              }}
            >
              <Text style={{ color: selectedSousTraitant === "TOUS" ? "#fff" : "#0F172A", fontWeight: selectedSousTraitant === "TOUS" ? "700" : "400" }}>
                Tous les sous-traitants
              </Text>
            </TouchableOpacity>
            
            {availableSousTraitants.map((name, index) => (
              <TouchableOpacity
                key={index}
                onPress={() => {
                  setSelectedSousTraitant(name);
                  setShowSousTraitantPicker(false);
                }}
                style={{
                  padding: theme.Spacing.md,
                  backgroundColor: selectedSousTraitant === name ? theme.Colors.primary : theme.Colors.surface,
                  borderRadius: 8,
                  marginBottom: theme.Spacing.sm,
                }}
              >
                <Text style={{ color: selectedSousTraitant === name ? "#fff" : "#0F172A", fontWeight: selectedSousTraitant === name ? "700" : "400" }}>
                  {name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          
          <AppButton
            title="Annuler"
            onPress={() => setShowSousTraitantPicker(false)}
            style={{ marginTop: theme.Spacing.md, backgroundColor: theme.Colors.surface, borderWidth: 1, borderColor: theme.Colors.subtleBorder }}
          />
        </View>
      </ModalView>
      
      {/* SECTION IMPORT */}
      <View style={{ marginBottom: 24, padding: theme.Spacing.md, backgroundColor: theme.Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.Colors.subtleBorder }}>
        <Text style={{ fontWeight: "bold", marginBottom: 12, fontSize: 18 }}>
          Importer une nouvelle tournée
        </Text>

        <View style={{ marginVertical: 12 }}>
          <Button title="Choisir un fichier (.pdf ou .xlsx)" onPress={pickImportFile} />
          <Text style={{ fontSize: 12, marginTop: 4 }}>
            {importFile
              ? `Fichier sélectionné : ${importFile.name}`
              : "Aucun fichier sélectionné."}
          </Text>
        </View>

        {importLoading && <ActivityIndicator />}

        {importMessage && (
          <Text style={{ color: "green", marginTop: 8 }}>{importMessage}</Text>
        )}
        {importError && (
          <Text style={{ color: "red", marginTop: 8 }}>{importError}</Text>
        )}
      </View>

      {/* SECTION IMPORT CANIAO */}
      <View style={{ marginBottom: 24, padding: theme.Spacing.md, backgroundColor: '#FFF7ED', borderRadius: 12, borderWidth: 2, borderColor: '#FB923C' }}>
        <Text style={{ fontWeight: "bold", marginBottom: 12, fontSize: 18, color: '#EA580C' }}>
          📦 Importer fichier CANIAO (PDF)
        </Text>
        <Text style={{ fontSize: 12, marginBottom: 12, color: '#9A3412' }}>
          Import automatique : crée une tournée par chauffeur depuis le fichier quotidien CANIAO
        </Text>

        <View style={{ marginVertical: 12 }}>
          <Button title="Choisir fichier CANIAO (.pdf)" onPress={pickCanaioFile} />
        </View>

        {canaioLoading && <ActivityIndicator />}

        {canaioMessage && (
          <Text style={{ color: "green", marginTop: 8, fontWeight: "600" }}>{canaioMessage}</Text>
        )}
        {canaioError && (
          <Text style={{ color: "red", marginTop: 8 }}>{canaioError}</Text>
        )}
      </View>

      {/* SECTION LISTE DES TOURNÉES */}
      <View style={{ marginBottom: theme.Spacing.lg }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: theme.Spacing.md,
          }}
        >
          <Text
            style={{
              fontWeight: "700",
              fontSize: 16,
              color: theme.Colors.text,
            }}
          >
            📋 Tournées
          </Text>
          <View style={{ flexDirection: "row", gap: theme.Spacing.xs }}>
            <TouchableOpacity
              onPress={handleRestoreDeleted}
              style={{
                backgroundColor: theme.Colors.success,
                paddingHorizontal: theme.Spacing.sm,
                paddingVertical: theme.Spacing.xs,
                borderRadius: 6,
              }}
            >
              <Text
                style={{
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: "600",
                }}
              >
                ♻️ Restaurer
              </Text>
            </TouchableOpacity>
            {tours.length > 0 && (
              <TouchableOpacity
                onPress={handleDeleteAllTours}
                style={{
                  backgroundColor: theme.Colors.danger,
                  paddingHorizontal: theme.Spacing.sm,
                  paddingVertical: theme.Spacing.xs,
                  borderRadius: 6,
                }}
              >
                <Text
                  style={{
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: "600",
                  }}
                >
                  🗑️ Effacer
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {loading && (
          <View style={{ alignItems: "center", paddingVertical: theme.Spacing.lg }}>
            <ActivityIndicator size="large" color={theme.Colors.primary} />
          </View>
        )}

        {error && (
          <View
            style={{
              backgroundColor: "#FEE2E2",
              borderLeftWidth: 4,
              borderLeftColor: theme.Colors.danger,
              borderRadius: 8,
              padding: theme.Spacing.md,
              marginBottom: theme.Spacing.md,
            }}
          >
            <Text
              style={{
                color: theme.Colors.danger,
                fontSize: 12,
                fontWeight: "500",
              }}
            >
              {error}
            </Text>
          </View>
        )}

        {message && (
          <View
            style={{
              backgroundColor: "#DCFCE7",
              borderLeftWidth: 4,
              borderLeftColor: theme.Colors.success,
              borderRadius: 8,
              padding: theme.Spacing.md,
              marginBottom: theme.Spacing.md,
            }}
          >
            <Text
              style={{
                color: theme.Colors.success,
                fontSize: 12,
                fontWeight: "500",
              }}
            >
              ✓ {message}
            </Text>
          </View>
        )}

        {tours.length > 0 && (
          <View
            style={{
              borderWidth: 1,
              borderColor: theme.Colors.borderStrong,
              borderRadius: 12,
              overflow: "hidden",
              backgroundColor: theme.Colors.surface,
            }}
          >
            {/* En-tête du tableau */}
            <View
              style={{
                flexDirection: "row",
                backgroundColor: theme.Colors.primary,
                padding: theme.Spacing.md,
              }}
            >
              <Text
                style={{
                  flex: 3,
                  fontWeight: "bold",
                  color: "#fff",
                  fontSize: 11,
                }}
              >
                Chauffeur
              </Text>
              <Text
                style={{
                  flex: 2,
                  fontWeight: "bold",
                  color: "#fff",
                  fontSize: 11,
                }}
              >
                Date
              </Text>
              <Text
                style={{
                  flex: 1,
                  fontWeight: "bold",
                  color: "#fff",
                  fontSize: 11,
                  textAlign: "center",
                }}
              >
                Colis
              </Text>
              <View style={{ flex: 1.5, justifyContent: "center" }} />
            </View>

            {/* Lignes du tableau */}
            {tours.map((tour, index) => (
              <View
                key={tour.id}
                style={{
                  flexDirection: "row",
                  padding: theme.Spacing.md,
                  borderTopWidth: index > 0 ? 1 : 0,
                  borderTopColor: theme.Colors.subtleBorder,
                  backgroundColor:
                    index % 2 === 0
                      ? theme.Colors.surface
                      : theme.Colors.surfaceMuted,
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    flex: 3,
                    fontSize: 13,
                    fontWeight: "500",
                    color: theme.Colors.text,
                  }}
                >
                  {tour.chauffeurName}
                </Text>
                <Text
                  style={{
                    flex: 2,
                    fontSize: 12,
                    color: theme.Colors.text,
                  }}
                >
                  {formatDateToFrench(tour.date)}
                </Text>
                <Text
                  style={{
                    flex: 1,
                    fontSize: 12,
                    textAlign: "center",
                    fontWeight: "600",
                    color: theme.Colors.primary,
                  }}
                >
                  {tour.colisCount}
                </Text>
                <View
                  style={{
                    flex: 1.5,
                    flexDirection: "row",
                    gap: theme.Spacing.xs,
                    justifyContent: "flex-end",
                  }}
                >
                  <TouchableOpacity
                    onPress={() => handleDownload(tour)}
                    style={{
                      backgroundColor: theme.Colors.primary,
                      paddingHorizontal: 6,
                      paddingVertical: 4,
                      borderRadius: 4,
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: "#fff",
                        fontSize: 10,
                      }}
                    >
                      📥
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDelete(tour)}
                    style={{
                      backgroundColor: theme.Colors.danger,
                      paddingHorizontal: 6,
                      paddingVertical: 4,
                      borderRadius: 4,
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: "#fff",
                        fontSize: 10,
                      }}
                    >
                      🗑️
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {tours.length === 0 && !loading && (
          <View
            style={{
              backgroundColor: theme.Colors.surfaceMuted,
              borderRadius: 8,
              padding: theme.Spacing.lg,
              alignItems: "center",
            }}
          >
            <Text
              style={{
                fontSize: 13,
                color: theme.Colors.muted,
                fontStyle: "italic",
              }}
            >
              Aucune tournée trouvée
            </Text>
          </View>
        )}
      </View>

      {/* SECTION TOURNÉES CANIAO */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: theme.Spacing.md,
          marginTop: theme.Spacing.xl,
        }}
      >
        <Text
          style={{
            fontWeight: "700",
            fontSize: 16,
            color: theme.Colors.caniaoDark,
          }}
        >
          📦 Tournées CANIAO
        </Text>
        {canaioTours.length > 0 && (
          <TouchableOpacity
            onPress={handleDeleteAllCanaioTours}
            style={{
              backgroundColor: theme.Colors.danger,
              paddingHorizontal: theme.Spacing.sm,
              paddingVertical: theme.Spacing.xs,
              borderRadius: 6,
            }}
          >
            <Text
              style={{
                color: "#fff",
                fontSize: 11,
                fontWeight: "600",
              }}
            >
              🗑️ Effacer
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {canaioLoading && (
        <ActivityIndicator style={{ marginBottom: theme.Spacing.md }} />
      )}

      {canaioError && (
        <Text style={{ color: "red", marginBottom: theme.Spacing.sm }}>
          {canaioError}
        </Text>
      )}
      {canaioMessage && !canaioError && (
        <Text style={{ color: "green", marginBottom: theme.Spacing.sm }}>
          {canaioMessage}
        </Text>
      )}

      {canaioTours.length > 0 && (
        <View
          style={{
            borderWidth: 2,
            borderColor: theme.Colors.caniaoBorder,
            borderRadius: 12,
            overflow: "hidden",
            backgroundColor: theme.Colors.surface,
          }}
        >
          {/* En-tête du tableau CANIAO */}
          <View
            style={{
              flexDirection: "row",
              backgroundColor: theme.Colors.caniao,
              padding: theme.Spacing.md,
            }}
          >
            <Text
              style={{
                flex: 3,
                fontWeight: "bold",
                color: "#fff",
                fontSize: 11,
              }}
            >
              Chauffeur
            </Text>
            <Text
              style={{
                flex: 2,
                fontWeight: "bold",
                color: "#fff",
                fontSize: 11,
              }}
            >
              Date
            </Text>
            <Text
              style={{
                flex: 1,
                fontWeight: "bold",
                color: "#fff",
                fontSize: 11,
                textAlign: "center",
              }}
            >
              Colis
            </Text>
            <View style={{ flex: 1.5, justifyContent: "center" }} />
          </View>
          
          {/* Lignes du tableau CANIAO */}
          {canaioTours.map((tour, index) => (
            <View 
              key={tour.id} 
              style={{ 
                flexDirection: 'row', 
                padding: theme.Spacing.md, 
                borderTopWidth: index > 0 ? 1 : 0, 
                borderTopColor: theme.Colors.caniaoBorder,
                backgroundColor: index % 2 === 0 ? theme.Colors.surface : theme.Colors.caniaoSoft,
                alignItems: 'center'
              }}
            >
              <Text style={{ flex: 3, fontSize: 13, fontWeight: '500', color: theme.Colors.text }}>{tour.chauffeurName}</Text>
              <Text style={{ flex: 2, fontSize: 12, color: theme.Colors.text }}>{formatDateToFrench(tour.date)}</Text>
              <Text style={{ flex: 1, fontSize: 12, textAlign: 'center', fontWeight: '600', color: theme.Colors.caniao }}>{tour.colisCount}</Text>
              <View style={{ flex: 1.5, flexDirection: 'row', gap: theme.Spacing.xs, justifyContent: 'flex-end', alignItems: 'center' }}>
                <TouchableOpacity 
                  onPress={() => handleDownload(tour)}
                  style={{ backgroundColor: theme.Colors.caniao, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 4, justifyContent: 'center', alignItems: 'center' }}
                >
                  <Text style={{ color: '#fff', fontSize: 10 }}>📥</Text>
                </TouchableOpacity>
                {/* Suppression individuelle désactivée pour l'admin : la suppression des tournées CANIAO ne peut se faire qu'en masse via le bouton "🗑️ Effacer" en haut de la section. */}
              </View>
            </View>
          ))}
        </View>
      )}

      {canaioTours.length === 0 && !canaioLoading && (
        <Text style={{ color: '#9A3412', fontStyle: 'italic', marginBottom: 8 }}>
          Aucune tournée CANIAO pour cette date.
        </Text>
      )}

      <View style={{ marginTop: 16 }}>
        <AppButton title="← Retour" onPress={onBack} style={{ backgroundColor: "#E5E7EB", borderWidth: 1, borderColor: "#6B7280" }} />
      </View>
    </ScrollView>
  );
}

// ===============
// ADMIN_USERS (avec onglets Utilisateurs / Chauffeurs)
// ===============

interface AdminUsersProps {
  onBack: () => void;
  authToken: string | null;
}

interface BackendUser {
  id: number;
  login: string;
  role: "ADMIN" | "DISPATCHER" | "TRIEUR";
  sousTraitantName: string | null;
}

interface Chauffeur {
  name: string;
  sousTraitant: string;
}

function AdminUsersScreen({ onBack, authToken }: AdminUsersProps) {
  const [activeTab, setActiveTab] = useState<'users' | 'chauffeurs'>('users');

  // Gestion du bouton retour Android
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => backHandler.remove();
  }, [onBack]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.Colors.bg }}>
      {/* Header avec onglets */}
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <Text style={[styles.title, { marginBottom: 12 }]}>👥 Gestion</Text>
        
        {/* Onglets */}
        <View style={{
          flexDirection: 'row',
          backgroundColor: theme.Colors.surfaceMuted,
          borderRadius: 10,
          padding: 4,
        }}>
          <TouchableOpacity
            onPress={() => setActiveTab('users')}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 8,
              backgroundColor: activeTab === 'users' ? theme.Colors.primary : 'transparent',
              alignItems: 'center',
            }}
          >
            <Text style={{ 
              color: activeTab === 'users' ? '#fff' : theme.Colors.textMuted,
              fontWeight: activeTab === 'users' ? 'bold' : 'normal',
            }}>
              👤 Utilisateurs
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setActiveTab('chauffeurs')}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 8,
              backgroundColor: activeTab === 'chauffeurs' ? theme.Colors.primary : 'transparent',
              alignItems: 'center',
            }}
          >
            <Text style={{ 
              color: activeTab === 'chauffeurs' ? '#fff' : theme.Colors.textMuted,
              fontWeight: activeTab === 'chauffeurs' ? 'bold' : 'normal',
            }}>
              🚗 Chauffeurs
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Contenu selon l'onglet */}
      <View style={{ flex: 1 }}>
        {activeTab === 'users' ? (
          <UsersTab authToken={authToken} onBack={onBack} />
        ) : (
          <ChauffeursTab authToken={authToken} onBack={onBack} />
        )}
      </View>
    </SafeAreaView>
  );
}

// ===============
// ONGLET UTILISATEURS
// ===============
function UsersTab({ authToken, onBack }: { authToken: string | null; onBack: () => void }) {
  const [users, setUsers] = useState<BackendUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal de création/modification
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<BackendUser | null>(null);
  const [userLogin, setUserLogin] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userRole, setUserRole] = useState<"ADMIN" | "DISPATCHER" | "TRIEUR">("DISPATCHER");
  const [userSousTraitant, setUserSousTraitant] = useState("");
  const [newSousTraitantName, setNewSousTraitantName] = useState("");
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [availableSousTraitants, setAvailableSousTraitants] = useState<string[]>([]);
  const [showSousTraitantPicker, setShowSousTraitantPicker] = useState(false);

  useEffect(() => {
    fetchUsers();
    fetchSousTraitants();
  }, []);

  const fetchSousTraitants = async () => {
    if (!authToken) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/sous-traitants`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!response.ok) return;
      const data = await response.json();
      setAvailableSousTraitants(data.sousTraitants || []);
    } catch (e) {}
  };

  const fetchUsers = async () => {
    if (!authToken) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/users`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!response.ok) throw new Error("Erreur lors du chargement");
      const data = await response.json();
      setUsers(data.users || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = () => {
    setEditingUser(null);
    setUserLogin("");
    setUserPassword("");
    setUserRole("DISPATCHER");
    setUserSousTraitant("");
    setNewSousTraitantName("");
    setModalError(null);
    setShowUserModal(true);
  };

  const handleEditUser = (user: BackendUser) => {
    setEditingUser(user);
    setUserLogin(user.login);
    setUserPassword("");
    setUserRole(user.role);
    setUserSousTraitant(user.sousTraitantName || "");
    setNewSousTraitantName("");
    setModalError(null);
    setShowUserModal(true);
  };

  const handleSaveUser = async () => {
    if (!authToken) return;

    if (!userLogin.trim()) {
      setModalError("Le login est requis");
      return;
    }
    if (!editingUser && !userPassword.trim()) {
      setModalError("Le mot de passe est requis");
      return;
    }
    if ((userRole === "DISPATCHER" || userRole === "TRIEUR")) {
      if (userSousTraitant === "__new__") {
        if (!newSousTraitantName.trim()) {
          setModalError("Nom du sous-traitant requis");
          return;
        }
      } else if (!userSousTraitant.trim()) {
        setModalError("Sous-traitant requis");
        return;
      }
    }

    setModalLoading(true);
    setModalError(null);

    try {
      const url = editingUser
        ? `${API_BASE_URL}/api/admin/users/${editingUser.id}`
        : `${API_BASE_URL}/api/admin/users`;

      const method = editingUser ? "PUT" : "POST";

      let sousTraitantToSend = null;
      if (userRole === "DISPATCHER" || userRole === "TRIEUR") {
        sousTraitantToSend = userSousTraitant === "__new__" ? newSousTraitantName.trim() : userSousTraitant.trim();
      }

      const body: any = {
        login: userLogin.trim(),
        role: userRole,
        sousTraitantName: sousTraitantToSend
      };

      if (userPassword.trim()) {
        body.password = userPassword.trim();
      }

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Erreur");
      }

      setShowUserModal(false);
      fetchUsers();
      fetchSousTraitants();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setModalLoading(false);
    }
  };

  const handleDeleteUser = (user: BackendUser) => {
    Alert.alert(
      "Supprimer",
      `Supprimer l'utilisateur "${user.login}" ?`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: async () => {
            try {
              const response = await fetch(`${API_BASE_URL}/api/admin/users/${user.id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${authToken}` }
              });
              if (!response.ok) throw new Error("Erreur suppression");
              fetchUsers();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (err) {
              Alert.alert("Erreur", "Impossible de supprimer l'utilisateur");
            }
          }
        }
      ]
    );
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'ADMIN': return '#ef4444';
      case 'DISPATCHER': return '#22c55e';
      case 'TRIEUR': return '#3b82f6';
      default: return '#888';
    }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
      {/* Bouton ajouter */}
      <TouchableOpacity
        onPress={handleCreateUser}
        style={{
          backgroundColor: theme.Colors.success,
          padding: 14,
          borderRadius: 10,
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: 'bold' }}>➕ Nouvel utilisateur</Text>
      </TouchableOpacity>

      {loading && <ActivityIndicator color={theme.Colors.primary} />}
      {error && <Text style={{ color: theme.Colors.danger, marginBottom: 12 }}>{error}</Text>}

      {/* Liste des utilisateurs */}
      {users.map((user) => (
        <View
          key={user.id}
          style={{
            backgroundColor: theme.Colors.surface,
            padding: 14,
            borderRadius: 10,
            marginBottom: 10,
            borderWidth: 1,
            borderColor: theme.Colors.subtleBorder,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.Colors.text, fontWeight: 'bold', fontSize: 16 }}>
                {user.login}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <View style={{
                  backgroundColor: getRoleColor(user.role),
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 10,
                }}>
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>{user.role}</Text>
                </View>
                {user.sousTraitantName && (
                  <Text style={{ color: theme.Colors.textMuted, fontSize: 12 }}>
                    {user.sousTraitantName}
                  </Text>
                )}
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity onPress={() => handleEditUser(user)} style={{ padding: 8 }}>
                <Text style={{ fontSize: 18 }}>✏️</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDeleteUser(user)} style={{ padding: 8 }}>
                <Text style={{ fontSize: 18 }}>🗑️</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ))}

      {users.length === 0 && !loading && (
        <Text style={{ color: theme.Colors.textMuted, textAlign: 'center' }}>
          Aucun utilisateur
        </Text>
      )}

      {/* Modal utilisateur */}
      <RNModal visible={showUserModal} animationType="slide" transparent>
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'center',
          padding: 20,
        }}>
          <View style={{
            backgroundColor: theme.Colors.surface,
            borderRadius: 16,
            padding: 20,
            maxHeight: '80%',
          }}>
            <Text style={{ color: theme.Colors.text, fontSize: 18, fontWeight: 'bold', marginBottom: 16 }}>
              {editingUser ? '✏️ Modifier utilisateur' : '➕ Nouvel utilisateur'}
            </Text>

            {modalError && (
              <Text style={{ color: theme.Colors.danger, marginBottom: 12 }}>{modalError}</Text>
            )}

            <ScrollView>
              <Text style={{ color: theme.Colors.textMuted, marginBottom: 4 }}>Login</Text>
              <TextInput
                value={userLogin}
                onChangeText={setUserLogin}
                placeholder="Nom d'utilisateur"
                style={{
                  backgroundColor: theme.Colors.surfaceMuted,
                  padding: 12,
                  borderRadius: 8,
                  marginBottom: 12,
                  color: theme.Colors.text,
                }}
                placeholderTextColor={theme.Colors.textMuted}
              />

              <Text style={{ color: theme.Colors.textMuted, marginBottom: 4 }}>
                Mot de passe {editingUser && '(laisser vide pour ne pas changer)'}
              </Text>
              <TextInput
                value={userPassword}
                onChangeText={setUserPassword}
                placeholder="Mot de passe"
                secureTextEntry
                style={{
                  backgroundColor: theme.Colors.surfaceMuted,
                  padding: 12,
                  borderRadius: 8,
                  marginBottom: 12,
                  color: theme.Colors.text,
                }}
                placeholderTextColor={theme.Colors.textMuted}
              />

              <Text style={{ color: theme.Colors.textMuted, marginBottom: 4 }}>Rôle</Text>
              <TouchableOpacity
                onPress={() => setShowRolePicker(true)}
                style={{
                  backgroundColor: theme.Colors.surfaceMuted,
                  padding: 12,
                  borderRadius: 8,
                  marginBottom: 12,
                }}
              >
                <Text style={{ color: theme.Colors.text }}>{userRole}</Text>
              </TouchableOpacity>

              {(userRole === "DISPATCHER" || userRole === "TRIEUR") && (
                <>
                  <Text style={{ color: theme.Colors.textMuted, marginBottom: 4 }}>Sous-traitant</Text>
                  <TouchableOpacity
                    onPress={() => setShowSousTraitantPicker(true)}
                    style={{
                      backgroundColor: theme.Colors.surfaceMuted,
                      padding: 12,
                      borderRadius: 8,
                      marginBottom: 12,
                    }}
                  >
                    <Text style={{ color: userSousTraitant ? theme.Colors.text : theme.Colors.textMuted }}>
                      {userSousTraitant === "__new__" ? "Nouveau..." : (userSousTraitant || "Sélectionner")}
                    </Text>
                  </TouchableOpacity>

                  {userSousTraitant === "__new__" && (
                    <TextInput
                      value={newSousTraitantName}
                      onChangeText={setNewSousTraitantName}
                      placeholder="Nom du nouveau sous-traitant"
                      style={{
                        backgroundColor: theme.Colors.surfaceMuted,
                        padding: 12,
                        borderRadius: 8,
                        marginBottom: 12,
                        color: theme.Colors.text,
                      }}
                      placeholderTextColor={theme.Colors.textMuted}
                    />
                  )}
                </>
              )}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <TouchableOpacity
                onPress={() => setShowUserModal(false)}
                style={{
                  flex: 1,
                  padding: 14,
                  borderRadius: 8,
                  backgroundColor: theme.Colors.surfaceMuted,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: theme.Colors.text }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveUser}
                disabled={modalLoading}
                style={{
                  flex: 1,
                  padding: 14,
                  borderRadius: 8,
                  backgroundColor: theme.Colors.success,
                  alignItems: 'center',
                  opacity: modalLoading ? 0.6 : 1,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>
                  {modalLoading ? '...' : 'Enregistrer'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </RNModal>

      {/* Modal rôle */}
      <RNModal visible={showRolePicker} animationType="fade" transparent>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }}
          onPress={() => setShowRolePicker(false)}
        >
          <View style={{ backgroundColor: theme.Colors.surface, borderRadius: 12, padding: 16 }}>
            <Text style={{ color: theme.Colors.text, fontWeight: 'bold', marginBottom: 12 }}>Rôle</Text>
            {(['ADMIN', 'DISPATCHER', 'TRIEUR'] as const).map((role) => (
              <TouchableOpacity
                key={role}
                onPress={() => { setUserRole(role); setShowRolePicker(false); }}
                style={{
                  padding: 14,
                  borderRadius: 8,
                  backgroundColor: userRole === role ? theme.Colors.primary : theme.Colors.surfaceMuted,
                  marginBottom: 8,
                }}
              >
                <Text style={{ color: userRole === role ? '#fff' : theme.Colors.text }}>{role}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </RNModal>

      {/* Modal sous-traitant */}
      <RNModal visible={showSousTraitantPicker} animationType="fade" transparent>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }}
          onPress={() => setShowSousTraitantPicker(false)}
        >
          <View style={{ backgroundColor: theme.Colors.surface, borderRadius: 12, padding: 16, maxHeight: '60%' }}>
            <Text style={{ color: theme.Colors.text, fontWeight: 'bold', marginBottom: 12 }}>Sous-traitant</Text>
            <ScrollView>
              {availableSousTraitants.map((st) => (
                <TouchableOpacity
                  key={st}
                  onPress={() => { setUserSousTraitant(st); setShowSousTraitantPicker(false); }}
                  style={{
                    padding: 14,
                    borderRadius: 8,
                    backgroundColor: userSousTraitant === st ? theme.Colors.primary : theme.Colors.surfaceMuted,
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ color: userSousTraitant === st ? '#fff' : theme.Colors.text }}>{st}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                onPress={() => { setUserSousTraitant("__new__"); setShowSousTraitantPicker(false); }}
                style={{
                  padding: 14,
                  borderRadius: 8,
                  backgroundColor: userSousTraitant === "__new__" ? theme.Colors.primary : theme.Colors.surfaceMuted,
                  marginBottom: 8,
                }}
              >
                <Text style={{ color: userSousTraitant === "__new__" ? '#fff' : theme.Colors.primary }}>
                  + Nouveau sous-traitant...
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </RNModal>

      {/* Bouton retour */}
      <TouchableOpacity
        onPress={onBack}
        style={{
          backgroundColor: theme.Colors.muted,
          padding: 14,
          borderRadius: 10,
          alignItems: 'center',
          marginTop: 16,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: 'bold' }}>← Retour</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ===============
// ONGLET CHAUFFEURS
// ===============
function ChauffeursTab({ authToken, onBack }: { authToken: string | null; onBack: () => void }) {
  const [chauffeurs, setChauffeurs] = useState<Chauffeur[]>([]);
  const [sousTraitants, setSousTraitants] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Filtre
  const [filterST, setFilterST] = useState<string>('TOUS');
  const [showFilterPicker, setShowFilterPicker] = useState(false);

  // Ajout chauffeur
  const [newChauffeur, setNewChauffeur] = useState('');
  const [newChauffeurST, setNewChauffeurST] = useState('');
  const [showSTPickerAdd, setShowSTPickerAdd] = useState(false);

  // Ajout sous-traitant
  const [newST, setNewST] = useState('');

  // Édition
  const [editingChauffeur, setEditingChauffeur] = useState<Chauffeur | null>(null);
  const [editST, setEditST] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showSTPickerEdit, setShowSTPickerEdit] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    if (!authToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/chauffeurs`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!res.ok) throw new Error("Erreur chargement");
      const data = await res.json();
      setChauffeurs(data.chauffeurs || []);
      setSousTraitants(data.sousTraitants || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const addChauffeur = async () => {
    if (!authToken || !newChauffeur.trim() || !newChauffeurST) {
      setError("Nom et sous-traitant requis");
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/chauffeurs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ name: newChauffeur.trim(), sousTraitant: newChauffeurST })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Erreur");
      }
      setNewChauffeur('');
      setNewChauffeurST('');
      setMessage("✅ Chauffeur ajouté");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const addSousTraitant = async () => {
    if (!authToken || !newST.trim()) {
      setError("Nom requis");
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/sous-traitants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ name: newST.trim() })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Erreur");
      }
      setNewST('');
      setMessage("✅ Sous-traitant ajouté");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deleteChauffeur = (ch: Chauffeur) => {
    Alert.alert("Supprimer", `Supprimer le chauffeur "${ch.name}" ?`, [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer",
        style: "destructive",
        onPress: async () => {
          try {
            const res = await fetch(`${API_BASE_URL}/api/chauffeurs/${encodeURIComponent(ch.name)}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${authToken}` }
            });
            if (!res.ok) throw new Error("Erreur");
            setMessage("✅ Chauffeur supprimé");
            fetchData();
          } catch (err) {
            setError("Erreur suppression");
          }
        }
      }
    ]);
  };

  const deleteSousTraitant = (st: string) => {
    const count = chauffeurs.filter(c => c.sousTraitant === st).length;
    if (count > 0) {
      Alert.alert("Impossible", `Ce sous-traitant a encore ${count} chauffeur(s)`);
      return;
    }
    Alert.alert("Supprimer", `Supprimer le sous-traitant "${st}" ?`, [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer",
        style: "destructive",
        onPress: async () => {
          try {
            const res = await fetch(`${API_BASE_URL}/api/sous-traitants/${encodeURIComponent(st)}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${authToken}` }
            });
            if (!res.ok) throw new Error("Erreur");
            setMessage("✅ Sous-traitant supprimé");
            fetchData();
          } catch (err) {
            setError("Erreur suppression");
          }
        }
      }
    ]);
  };

  const openEditChauffeur = (ch: Chauffeur) => {
    setEditingChauffeur(ch);
    setEditST(ch.sousTraitant);
    setShowEditModal(true);
  };

  const saveEditChauffeur = async () => {
    if (!authToken || !editingChauffeur || !editST) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/chauffeurs/${encodeURIComponent(editingChauffeur.name)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ sousTraitant: editST })
      });
      if (!res.ok) throw new Error("Erreur");
      setShowEditModal(false);
      setMessage("✅ Chauffeur modifié");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      fetchData();
    } catch (err) {
      setError("Erreur modification");
    }
  };

  // Filtrer les chauffeurs
  const filteredChauffeurs = filterST === 'TOUS' 
    ? chauffeurs 
    : chauffeurs.filter(c => c.sousTraitant === filterST);

  // Grouper par sous-traitant
  const grouped: Record<string, Chauffeur[]> = {};
  filteredChauffeurs.forEach(ch => {
    if (!grouped[ch.sousTraitant]) grouped[ch.sousTraitant] = [];
    grouped[ch.sousTraitant].push(ch);
  });

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
      {/* Messages */}
      {message && (
        <Text style={{ color: theme.Colors.success, marginBottom: 12, textAlign: 'center' }}>{message}</Text>
      )}
      {error && (
        <Text style={{ color: theme.Colors.danger, marginBottom: 12, textAlign: 'center' }}>{error}</Text>
      )}

      {/* Ajouter chauffeur */}
      <View style={{
        backgroundColor: theme.Colors.surface,
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: theme.Colors.subtleBorder,
      }}>
        <Text style={{ color: theme.Colors.text, fontWeight: 'bold', marginBottom: 12 }}>
          ➕ Ajouter un chauffeur
        </Text>
        <TextInput
          value={newChauffeur}
          onChangeText={setNewChauffeur}
          placeholder="Nom du chauffeur"
          style={{
            backgroundColor: theme.Colors.surfaceMuted,
            padding: 12,
            borderRadius: 8,
            marginBottom: 8,
            color: theme.Colors.text,
          }}
          placeholderTextColor={theme.Colors.textMuted}
        />
        <TouchableOpacity
          onPress={() => setShowSTPickerAdd(true)}
          style={{
            backgroundColor: theme.Colors.surfaceMuted,
            padding: 12,
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: newChauffeurST ? theme.Colors.text : theme.Colors.textMuted }}>
            {newChauffeurST || "Sélectionner un sous-traitant"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={addChauffeur}
          style={{
            backgroundColor: theme.Colors.success,
            padding: 12,
            borderRadius: 8,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontWeight: 'bold' }}>Ajouter</Text>
        </TouchableOpacity>
      </View>

      {/* Sous-traitants */}
      <View style={{
        backgroundColor: theme.Colors.surface,
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: theme.Colors.subtleBorder,
      }}>
        <Text style={{ color: theme.Colors.text, fontWeight: 'bold', marginBottom: 12 }}>
          🏢 Sous-traitants ({sousTraitants.length})
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {sousTraitants.map(st => {
            const count = chauffeurs.filter(c => c.sousTraitant === st).length;
            return (
              <View key={st} style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: theme.Colors.surfaceMuted,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 20,
                gap: 6,
              }}>
                <Text style={{ color: theme.Colors.text, fontWeight: 'bold' }}>{st}</Text>
                <View style={{
                  backgroundColor: theme.Colors.primary,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 10,
                }}>
                  <Text style={{ color: '#fff', fontSize: 11 }}>{count}</Text>
                </View>
                {count === 0 && (
                  <TouchableOpacity onPress={() => deleteSousTraitant(st)}>
                    <Text style={{ color: theme.Colors.danger, fontSize: 14 }}>🗑️</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            value={newST}
            onChangeText={setNewST}
            placeholder="Nouveau sous-traitant"
            style={{
              flex: 1,
              backgroundColor: theme.Colors.surfaceMuted,
              padding: 12,
              borderRadius: 8,
              color: theme.Colors.text,
            }}
            placeholderTextColor={theme.Colors.textMuted}
          />
          <TouchableOpacity
            onPress={addSousTraitant}
            style={{
              backgroundColor: theme.Colors.primary,
              paddingHorizontal: 16,
              borderRadius: 8,
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Liste chauffeurs */}
      <View style={{
        backgroundColor: theme.Colors.surface,
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.Colors.subtleBorder,
      }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ color: theme.Colors.text, fontWeight: 'bold' }}>
            🚗 Chauffeurs ({filteredChauffeurs.length})
          </Text>
          <TouchableOpacity
            onPress={() => setShowFilterPicker(true)}
            style={{
              backgroundColor: theme.Colors.surfaceMuted,
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 20,
            }}
          >
            <Text style={{ color: theme.Colors.text, fontSize: 13 }}>
              {filterST === 'TOUS' ? 'Tous' : filterST} ▼
            </Text>
          </TouchableOpacity>
        </View>

        {loading && <ActivityIndicator color={theme.Colors.primary} />}

        {Object.entries(grouped).map(([st, chs]) => (
          <View key={st} style={{ marginBottom: 16 }}>
            <Text style={{ color: theme.Colors.primary, fontWeight: 'bold', marginBottom: 8 }}>
              {st} ({chs.length})
            </Text>
            {chs.map(ch => (
              <View key={ch.name} style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: theme.Colors.surfaceMuted,
                padding: 12,
                borderRadius: 8,
                marginBottom: 6,
              }}>
                <Text style={{ flex: 1, color: theme.Colors.text }}>{ch.name}</Text>
                <TouchableOpacity onPress={() => openEditChauffeur(ch)} style={{ padding: 6 }}>
                  <Text style={{ fontSize: 16 }}>✏️</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteChauffeur(ch)} style={{ padding: 6 }}>
                  <Text style={{ fontSize: 16 }}>🗑️</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ))}

        {filteredChauffeurs.length === 0 && !loading && (
          <Text style={{ color: theme.Colors.textMuted, textAlign: 'center' }}>
            Aucun chauffeur
          </Text>
        )}
      </View>

      {/* Modal filtre */}
      <RNModal visible={showFilterPicker} animationType="fade" transparent>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }}
          onPress={() => setShowFilterPicker(false)}
        >
          <View style={{ backgroundColor: theme.Colors.surface, borderRadius: 12, padding: 16, maxHeight: '60%' }}>
            <Text style={{ color: theme.Colors.text, fontWeight: 'bold', marginBottom: 12 }}>Filtrer par sous-traitant</Text>
            <ScrollView>
              <TouchableOpacity
                onPress={() => { setFilterST('TOUS'); setShowFilterPicker(false); }}
                style={{
                  padding: 14,
                  borderRadius: 8,
                  backgroundColor: filterST === 'TOUS' ? theme.Colors.primary : theme.Colors.surfaceMuted,
                  marginBottom: 8,
                }}
              >
                <Text style={{ color: filterST === 'TOUS' ? '#fff' : theme.Colors.text }}>Tous</Text>
              </TouchableOpacity>
              {sousTraitants.map(st => (
                <TouchableOpacity
                  key={st}
                  onPress={() => { setFilterST(st); setShowFilterPicker(false); }}
                  style={{
                    padding: 14,
                    borderRadius: 8,
                    backgroundColor: filterST === st ? theme.Colors.primary : theme.Colors.surfaceMuted,
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ color: filterST === st ? '#fff' : theme.Colors.text }}>{st}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </RNModal>

      {/* Modal ST picker pour ajout */}
      <RNModal visible={showSTPickerAdd} animationType="fade" transparent>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }}
          onPress={() => setShowSTPickerAdd(false)}
        >
          <View style={{ backgroundColor: theme.Colors.surface, borderRadius: 12, padding: 16, maxHeight: '60%' }}>
            <Text style={{ color: theme.Colors.text, fontWeight: 'bold', marginBottom: 12 }}>Sous-traitant</Text>
            <ScrollView>
              {sousTraitants.map(st => (
                <TouchableOpacity
                  key={st}
                  onPress={() => { setNewChauffeurST(st); setShowSTPickerAdd(false); }}
                  style={{
                    padding: 14,
                    borderRadius: 8,
                    backgroundColor: newChauffeurST === st ? theme.Colors.primary : theme.Colors.surfaceMuted,
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ color: newChauffeurST === st ? '#fff' : theme.Colors.text }}>{st}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </RNModal>

      {/* Modal édition chauffeur */}
      <RNModal visible={showEditModal} animationType="slide" transparent>
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'center',
          padding: 20,
        }}>
          <View style={{
            backgroundColor: theme.Colors.surface,
            borderRadius: 16,
            padding: 20,
          }}>
            <Text style={{ color: theme.Colors.text, fontSize: 18, fontWeight: 'bold', marginBottom: 16 }}>
              ✏️ Modifier {editingChauffeur?.name}
            </Text>

            <Text style={{ color: theme.Colors.textMuted, marginBottom: 4 }}>Sous-traitant</Text>
            <TouchableOpacity
              onPress={() => setShowSTPickerEdit(true)}
              style={{
                backgroundColor: theme.Colors.surfaceMuted,
                padding: 12,
                borderRadius: 8,
                marginBottom: 16,
              }}
            >
              <Text style={{ color: theme.Colors.text }}>{editST}</Text>
            </TouchableOpacity>

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={() => setShowEditModal(false)}
                style={{
                  flex: 1,
                  padding: 14,
                  borderRadius: 8,
                  backgroundColor: theme.Colors.surfaceMuted,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: theme.Colors.text }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={saveEditChauffeur}
                style={{
                  flex: 1,
                  padding: 14,
                  borderRadius: 8,
                  backgroundColor: theme.Colors.success,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>Enregistrer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </RNModal>

      {/* Modal ST picker pour édition */}
      <RNModal visible={showSTPickerEdit} animationType="fade" transparent>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }}
          onPress={() => setShowSTPickerEdit(false)}
        >
          <View style={{ backgroundColor: theme.Colors.surface, borderRadius: 12, padding: 16, maxHeight: '60%' }}>
            <Text style={{ color: theme.Colors.text, fontWeight: 'bold', marginBottom: 12 }}>Sous-traitant</Text>
            <ScrollView>
              {sousTraitants.map(st => (
                <TouchableOpacity
                  key={st}
                  onPress={() => { setEditST(st); setShowSTPickerEdit(false); }}
                  style={{
                    padding: 14,
                    borderRadius: 8,
                    backgroundColor: editST === st ? theme.Colors.primary : theme.Colors.surfaceMuted,
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ color: editST === st ? '#fff' : theme.Colors.text }}>{st}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </RNModal>

      {/* Bouton retour */}
      <TouchableOpacity
        onPress={onBack}
        style={{
          backgroundColor: theme.Colors.muted,
          padding: 14,
          borderRadius: 10,
          alignItems: 'center',
          marginTop: 16,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: 'bold' }}>← Retour</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ===============
// PROFILE SCREEN - Gestion du profil utilisateur
// ===============

interface ProfileScreenProps {
  authToken: string | null;
  currentUser: User | null;
  onBack: () => void;
}

function ProfileScreen({ authToken, currentUser, onBack }: ProfileScreenProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Gestion du bouton retour Android
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => backHandler.remove();
  }, [onBack]);

  const handleChangePassword = async () => {
    setMessage(null);
    setError(null);

    if (!newPassword) {
      setError('Le nouveau mot de passe est requis');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    if (newPassword.length < 4) {
      setError('Le mot de passe doit faire au moins 4 caractères');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/profile/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ password: newPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Erreur lors de la modification');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      setMessage('Mot de passe modifié avec succès !');
      setNewPassword('');
      setConfirmPassword('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError('Impossible de contacter le serveur');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>👤 Mon profil</Text>

      {/* Informations du compte */}
      <View
        style={{
          backgroundColor: theme.Colors.surfaceMuted,
          borderRadius: 12,
          padding: theme.Spacing.md,
          marginBottom: theme.Spacing.lg,
        }}
      >
        <Text
          style={{
            fontSize: 14,
            fontWeight: '600',
            color: theme.Colors.text,
            marginBottom: theme.Spacing.md,
          }}
        >
          Informations du compte
        </Text>

        <View style={{ gap: theme.Spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ color: theme.Colors.muted, width: 100, fontSize: 13 }}>Login :</Text>
            <Text style={{ fontWeight: '600', fontSize: 14, color: theme.Colors.text }}>{currentUser?.login}</Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ color: theme.Colors.muted, width: 100, fontSize: 13 }}>Rôle :</Text>
            <View
              style={{
                backgroundColor:
                  currentUser?.role === 'ADMIN'
                    ? '#7b61ff'
                    : currentUser?.role === 'DISPATCHER'
                    ? '#3e4d2d'
                    : '#2d4d4d',
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 12,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>
                {currentUser?.role === 'ADMIN' && '🛡️ ADMIN'}
                {currentUser?.role === 'DISPATCHER' && '🚚 DISPATCHER'}
                {currentUser?.role === 'TRIEUR' && '🔧 TRIEUR'}
              </Text>
            </View>
          </View>

          {currentUser?.sousTraitantName && (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ color: theme.Colors.muted, width: 100, fontSize: 13 }}>Sous-traitant :</Text>
              <Text style={{ fontWeight: '600', fontSize: 14, color: theme.Colors.text }}>{currentUser.sousTraitantName}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Modification du mot de passe */}
      <View
        style={{
          backgroundColor: theme.Colors.primarySoft,
          borderLeftWidth: 4,
          borderLeftColor: '#8b5cf6',
          borderRadius: 12,
          padding: theme.Spacing.md,
          marginBottom: theme.Spacing.lg,
        }}
      >
        <Text
          style={{
            fontSize: 14,
            fontWeight: '600',
            color: theme.Colors.text,
            marginBottom: theme.Spacing.md,
          }}
        >
          🔒 Modifier mon mot de passe
        </Text>

        {message && (
          <View
            style={{
              backgroundColor: '#DCFCE7',
              borderLeftWidth: 4,
              borderLeftColor: theme.Colors.success,
              borderRadius: 8,
              padding: theme.Spacing.sm,
              marginBottom: theme.Spacing.md,
            }}
          >
            <Text style={{ color: theme.Colors.success, fontSize: 12, fontWeight: '500' }}>
              ✅ {message}
            </Text>
          </View>
        )}

        {error && (
          <View
            style={{
              backgroundColor: '#FEE2E2',
              borderLeftWidth: 4,
              borderLeftColor: theme.Colors.danger,
              borderRadius: 8,
              padding: theme.Spacing.sm,
              marginBottom: theme.Spacing.md,
            }}
          >
            <Text style={{ color: theme.Colors.danger, fontSize: 12, fontWeight: '500' }}>
              {error}
            </Text>
          </View>
        )}

        <View style={{ gap: theme.Spacing.sm }}>
          <View>
            <Text
              style={{
                fontSize: 12,
                color: theme.Colors.muted,
                marginBottom: theme.Spacing.xs,
                fontWeight: '500',
              }}
            >
              Nouveau mot de passe
            </Text>
            <TextInput
              style={{
                backgroundColor: theme.Colors.surface,
                borderWidth: 1,
                borderColor: theme.Colors.subtleBorder,
                borderRadius: 8,
                paddingVertical: theme.Spacing.sm,
                paddingHorizontal: theme.Spacing.sm,
                fontSize: 14,
                color: theme.Colors.text,
              }}
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Entrez votre nouveau mot de passe"
              placeholderTextColor={theme.Colors.muted}
            />
          </View>

          <View>
            <Text
              style={{
                fontSize: 12,
                color: theme.Colors.muted,
                marginBottom: theme.Spacing.xs,
                fontWeight: '500',
              }}
            >
              Confirmer le mot de passe
            </Text>
            <TextInput
              style={{
                backgroundColor: theme.Colors.surface,
                borderWidth: 1,
                borderColor: theme.Colors.subtleBorder,
                borderRadius: 8,
                paddingVertical: theme.Spacing.sm,
                paddingHorizontal: theme.Spacing.sm,
                fontSize: 14,
                color: theme.Colors.text,
              }}
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirmez votre nouveau mot de passe"
              placeholderTextColor={theme.Colors.muted}
            />
          </View>

          <View style={{ marginTop: theme.Spacing.sm }}>
            <Button
              title={loading ? 'Modification...' : 'Modifier le mot de passe'}
              onPress={handleChangePassword}
              disabled={loading || !newPassword || !confirmPassword}
            />
          </View>
        </View>
      </View>

      {/* Bouton Retour */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: theme.Colors.subtleBorder,
          paddingTop: theme.Spacing.lg,
          marginTop: theme.Spacing.md,
        }}
      >
        <Button title="← Retour" onPress={onBack} />
      </View>
    </ScrollView>
  );
}



// ===============
// DISPATCHER_TOURS (Version mutualisée comme le web)
// ===============

interface MutualizedDriver {
  name: string;
  sousTraitant: string | null;
  gofoCount: number;
  caniaoCount: number;
  totalCount: number;
  hasBoth: boolean;
  isOptimized?: boolean;
  isDispatcherImport?: boolean;
}

interface DispatcherToursProps {
  authToken: string | null;
  currentUser: User | null;
  onBack: () => void;
}

function DispatcherToursScreen({
  authToken,
  currentUser,
  onBack,
}: DispatcherToursProps) {
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDateString());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [internalDate, setInternalDate] = useState<Date>(parseDateString(selectedDate));
  
  const [drivers, setDrivers] = useState<MutualizedDriver[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  
  const [uploadingDriver, setUploadingDriver] = useState<string | null>(null);
  
  // État pour l'import de nouvelle tournée
  const [importLoading, setImportLoading] = useState(false);
  const [pendingFile, setPendingFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);

  // Gestion du bouton retour Android
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => backHandler.remove();
  }, [onBack]);

  useEffect(() => {
    setInternalDate(parseDateString(selectedDate));
    if (authToken) {
      loadDrivers(selectedDate);
    }
  }, [selectedDate, authToken]);

  const loadDrivers = async (date: string) => {
    if (!authToken) {
      setError("Vous n'êtes pas connecté.");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);
    
    try {
      const sousTraitant = currentUser?.sousTraitantName || '';
      
      // Utiliser l'API mutualized (la seule accessible au dispatcher)
      let url = `${API_BASE_URL}/api/mutualized/drivers?date=${encodeURIComponent(date)}`;
      if (sousTraitant) {
        url += `&sousTraitant=${encodeURIComponent(sousTraitant)}`;
      }
      
      console.log("Appel API mutualized:", url);
      
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const responseText = await res.text();
      console.log("Réponse brute:", res.status, responseText);

      if (!res.ok) {
        setError(`Erreur ${res.status}: ${responseText}`);
        return;
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        setError("Réponse invalide du serveur");
        return;
      }
      
      const drivers = data.drivers || [];
      console.log("Drivers reçus:", drivers.length);
      setDrivers(drivers);
      
      if (drivers.length === 0) {
        setMessage(`ℹ️ Aucune tournée trouvée pour le ${formatDateToFrench(date)}`);
      } else {
        setMessage(`✅ ${drivers.length} chauffeur(s) chargé(s)`);
      }
    } catch (e: any) {
      console.log("Erreur:", e);
      setError("Erreur réseau: " + (e.message || "Impossible de contacter le serveur"));
    } finally {
      setLoading(false);
    }
  };

  // Méthode alternative: charger depuis /api/tours et grouper par chauffeur
  const loadDriversFromTours = async (date: string, sousTraitant: string) => {
    // Charger TOUTES les tournées sans aucun filtre pour debug
    let url = `${API_BASE_URL}/api/tours?date=${encodeURIComponent(date)}`;

    console.log("Appel /api/tours:", url);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (!res.ok) {
      const text = await res.text();
      console.log("Erreur /api/tours:", res.status, text);
      throw new Error("Erreur lors du chargement: " + res.status);
    }

    const data = await res.json();
    const tours: BackendTour[] = data.tours || [];
    
    console.log("Tours reçues:", tours.length);
    
    // DEBUG: Afficher les sous-traitants trouvés
    const sousTraitants = [...new Set(tours.map(t => t.sousTraitantName))];
    console.log("Sous-traitants dans les tournées:", sousTraitants);

    // Grouper par chauffeur (SANS FILTRER)
    const driverMap = new Map<string, MutualizedDriver>();

    for (const tour of tours) {
      const name = tour.chauffeurName;
      if (!driverMap.has(name)) {
        driverMap.set(name, {
          name,
          sousTraitant: tour.sousTraitantName,
          gofoCount: 0,
          caniaoCount: 0,
          totalCount: 0,
          hasBoth: false,
          isOptimized: false,
        });
      }

      const driver = driverMap.get(name)!;
      if (tour.isCaniao) {
        driver.caniaoCount += tour.colisCount;
      } else {
        driver.gofoCount += tour.colisCount;
        if (tour.isDispatcherImport) {
          driver.isOptimized = true;
        }
      }
      driver.totalCount = driver.gofoCount + driver.caniaoCount;
      driver.hasBoth = driver.gofoCount > 0 && driver.caniaoCount > 0;
    }

    const result = Array.from(driverMap.values());
    console.log("Drivers groupés:", result.length);
    setDrivers(result);
    
    if (result.length === 0) {
      setMessage(`ℹ️ 0 tournée trouvée. Sous-traitants disponibles: ${sousTraitants.join(', ') || 'aucun'}`);
    } else {
      setMessage(`✅ ${result.length} chauffeur(s) - S-T trouvés: ${sousTraitants.join(', ')}`);
    }
  };

  const openDatePicker = () => setShowDatePicker(true);

  const onDateChange = (_event: any, selected?: Date) => {
    setShowDatePicker(false);
    if (selected) {
      setInternalDate(selected);
      const year = selected.getFullYear();
      const month = String(selected.getMonth() + 1).padStart(2, "0");
      const day = String(selected.getDate()).padStart(2, "0");
      setSelectedDate(`${year}-${month}-${day}`);
    }
  };

  // ===== IMPORT DE NOUVELLE TOURNÉE =====
  
  // Fonction pour importer un fichier avec une action spécifique
  const importTourWithAction = async (
    file: DocumentPicker.DocumentPickerAsset, 
    action?: string, 
    targetDriverName?: string
  ) => {
    setImportLoading(true);
    setError(null);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append("date", selectedDate);
      if (action) formData.append("action", action);
      if (targetDriverName) formData.append("targetDriverName", targetDriverName);
      formData.append("file", {
        uri: file.uri,
        name: file.name ?? "tournee.pdf",
        type: file.mimeType ?? "application/pdf",
      } as any);

      const res = await fetch(`${API_BASE_URL}/api/dispatcher/tours/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        // Gestion nom identique
        if (data.error === "EXACT_NAME_MATCH") {
          setPendingFile(file);
          Alert.alert(
            "⚠️ Tournée existante",
            `Une tournée pour "${data.existingDriverName}" existe déjà pour cette date.\n\nQue voulez-vous faire ?`,
            [
              { text: "Annuler", style: "cancel", onPress: () => setPendingFile(null) },
              { 
                text: "Nouvelle tournée", 
                onPress: () => {
                  importTourWithAction(file, "addNew");
                  setPendingFile(null);
                }
              },
              { 
                text: "Remplacer", 
                style: "destructive",
                onPress: () => {
                  importTourWithAction(file, "replace");
                  setPendingFile(null);
                }
              },
            ]
          );
          setImportLoading(false);
          return;
        }

        // Gestion nom similaire
        if (data.error === "SIMILAR_NAME_MATCH") {
          setPendingFile(file);
          Alert.alert(
            "⚠️ Nom similaire détecté",
            `Un chauffeur similaire existe: "${data.existingDriverName}"\nFichier importé: "${data.newDriverName}"\n\nVoulez-vous fusionner ?`,
            [
              { text: "Annuler", style: "cancel", onPress: () => setPendingFile(null) },
              { 
                text: `Nouveau: ${data.newDriverName}`, 
                onPress: () => {
                  importTourWithAction(file, "addNew");
                  setPendingFile(null);
                }
              },
              { 
                text: `Fusionner: ${data.existingDriverName}`, 
                onPress: () => {
                  importTourWithAction(file, "useName", data.existingDriverName);
                  setPendingFile(null);
                }
              },
            ]
          );
          setImportLoading(false);
          return;
        }

        // Gestion doublons de tracking
        if (data.error === "DUPLICATE_TRACKINGS") {
          const duplicates = data.duplicates || [];
          const total = data.totalDuplicates || duplicates.length;
          Alert.alert(
            "❌ Doublons détectés",
            `${total} numéro(s) de tracking existe(nt) déjà dans vos tournées.\n\nImport annulé pour éviter les doublons.`,
            [{ text: "OK" }]
          );
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setImportLoading(false);
          return;
        }

        setError(data.message || "Erreur lors de l'import");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setImportLoading(false);
        return;
      }

      // Succès
      const driverName = data.tour?.chauffeurName || "Inconnu";
      const colisCount = data.tour?.colisCount || 0;
      setMessage(`✅ Tournée créée pour ${driverName}: ${colisCount} colis`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      loadDrivers(selectedDate);
    } catch (e: any) {
      setError("Impossible de contacter le serveur");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setImportLoading(false);
    }
  };

  // Sélectionner et importer un fichier
  const handleSelectAndImportFile = async () => {
    setError(null);
    setMessage(null);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel"
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const file = result.assets[0];
      await importTourWithAction(file);
    } catch (e: any) {
      setError("Erreur lors de la sélection du fichier");
    }
  };

  // Télécharger Excel mutualisé
  const handleDownloadExcel = (driverName: string, source?: 'gofo' | 'cainiao' | null) => {
    let url = `${API_BASE_URL}/api/mutualized/driver/${encodeURIComponent(driverName)}/export?date=${selectedDate}&token=${encodeURIComponent(authToken || '')}`;
    if (source) {
      url += `&source=${source}`;
    }
    Linking.openURL(url).catch(() => {
      Alert.alert("Erreur", "Impossible d'ouvrir le lien de téléchargement.");
    });
  };

  // Upload fichier Spoke/optimisé
  const handleUploadSpoke = async (driverName: string) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const file = result.assets[0];
      setUploadingDriver(driverName);
      setError(null);
      setMessage(null);

      const formData = new FormData();
      formData.append("file", {
        uri: file.uri,
        name: file.name,
        type: file.mimeType || "application/pdf",
      } as any);
      formData.append("date", selectedDate);
      formData.append("driverName", driverName);
      formData.append("sousTraitantName", currentUser?.sousTraitantName || '');
      formData.append("isOptimized", "true");

      const res = await fetch(`${API_BASE_URL}/api/dispatcher/tour/optimized`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Erreur d'import");
      }

      const data = await res.json();
      setMessage(`✅ Tournée optimisée pour ${driverName}: ${data.colisCount || 0} colis`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      loadDrivers(selectedDate);
    } catch (e: any) {
      setError(e.message || "Erreur lors de l'import");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setUploadingDriver(null);
    }
  };

  // Supprimer tournée
  const handleDelete = (driverName: string) => {
    Alert.alert(
      "Supprimer la tournée",
      `Supprimer la tournée de ${driverName} ?\nLes colis seront mémorisés pour le tri.`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: async () => {
            try {
              setLoading(true);
              setError(null);
              setMessage(null);

              const res = await fetch(
                `${API_BASE_URL}/api/dispatcher/tour/${encodeURIComponent(driverName)}?date=${selectedDate}`,
                {
                  method: "DELETE",
                  headers: { Authorization: `Bearer ${authToken}` },
                }
              );

              if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || "Erreur lors de la suppression");
              }

              const data = await res.json();
              setMessage(`✅ Tournée de ${driverName} supprimée (${data.memorizedColis || 0} colis mémorisés)`);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              loadDrivers(selectedDate);
            } catch (e: any) {
              setError(e.message || "Erreur lors de la suppression");
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  // Restaurer tournées supprimées
  const handleRestoreDeleted = () => {
    Alert.alert(
      "♻️ Restaurer les tournées",
      `Restaurer les tournées supprimées du ${formatDateToFrench(selectedDate)} ?`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Restaurer",
          onPress: async () => {
            try {
              setLoading(true);
              setError(null);
              setMessage(null);

              const res = await fetch(`${API_BASE_URL}/api/dispatcher/tours/reset-all`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({ date: selectedDate, onlyDeleted: true }),
              });

              if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || "Erreur lors de la restauration");
              }

              const data = await res.json();
              setMessage(`✅ ${data.restoredTours || 0} tournée(s) restaurée(s) (${data.restoredColis || 0} colis)`);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              loadDrivers(selectedDate);
            } catch (e: any) {
              setError(e.message || "Erreur lors de la restauration");
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  // Séparer les chauffeurs par catégorie (comme le web)
  // Mutualisé/Optimisé : ceux qui ont les deux, sont optimisés, ou importés manuellement
  const mutualizedDrivers = drivers.filter(d => d.hasBoth || d.isOptimized || d.isDispatcherImport);
  // Gofo : TOUS ceux qui ont du Gofo (y compris optimisées, mais pas les imports manuels sans Gofo original)
  const gofoOnlyDrivers = drivers.filter(d => d.gofoCount > 0 && (!d.isDispatcherImport || d.isOptimized));
  // Cainiao : TOUS ceux qui ont du Cainiao (y compris optimisées, mais pas les imports manuels sans Cainiao original)
  const caniaoOnlyDrivers = drivers.filter(d => d.caniaoCount > 0 && (!d.isDispatcherImport || d.isOptimized));

  const totalGofo = drivers.reduce((sum, d) => sum + d.gofoCount, 0);
  const totalCaniao = drivers.reduce((sum, d) => sum + d.caniaoCount, 0);
  const totalColis = drivers.reduce((sum, d) => sum + d.totalCount, 0);

  // Composant pour afficher un chauffeur
  // forceStatus: force l'affichage du statut dans les tableaux lecture seule
  const DriverRow = ({ driver, canModify = true, forceStatus = null }: { driver: MutualizedDriver; canModify?: boolean; forceStatus?: 'gofo' | 'cainiao' | null }) => {
    const canDelete = canModify;
    const isUploading = uploadingDriver === driver.name;

    return (
      <View
        style={{
          flexDirection: "row",
          padding: theme.Spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: theme.Colors.subtleBorder,
          alignItems: "center",
          backgroundColor: theme.Colors.surface,
        }}
      >
        {/* Nom et stats */}
        <View style={{ flex: 3 }}>
          <Text style={{ fontWeight: "600", fontSize: 14, color: theme.Colors.text }}>
            {driver.name}
          </Text>
          <Text style={{ fontSize: 11, color: theme.Colors.muted }}>
            {driver.gofoCount > 0 && <Text style={{ color: '#2563eb' }}>{driver.gofoCount} Gofo</Text>}
            {driver.gofoCount > 0 && driver.caniaoCount > 0 && " + "}
            {driver.caniaoCount > 0 && <Text style={{ color: '#7c3aed' }}>{driver.caniaoCount} Cainiao</Text>}
          </Text>
        </View>

        {/* Total */}
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={{ fontWeight: "700", fontSize: 16, color: theme.Colors.primary }}>
            {forceStatus === 'gofo' ? driver.gofoCount : forceStatus === 'cainiao' ? driver.caniaoCount : driver.totalCount}
          </Text>
        </View>

        {/* Statut */}
        <View style={{ flex: 1.5, alignItems: "center" }}>
          <View
            style={{
              backgroundColor: forceStatus === 'gofo' ? '#3b82f6' : forceStatus === 'cainiao' ? '#8b5cf6' : driver.isOptimized ? '#22c55e' : driver.isDispatcherImport ? '#06b6d4' : driver.hasBoth ? '#f59e0b' : driver.gofoCount > 0 ? '#3b82f6' : '#8b5cf6',
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 10,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 9, fontWeight: '600' }}>
              {forceStatus === 'gofo' ? 'Gofo' : forceStatus === 'cainiao' ? 'Cainiao' : driver.isOptimized ? '✅ Optimisé' : driver.isDispatcherImport ? '📋 Ajouté' : driver.hasBoth ? 'Mutualisé' : driver.gofoCount > 0 ? 'Gofo' : 'Cainiao'}
            </Text>
          </View>
        </View>

        {/* Actions */}
        <View style={{ flex: 2, flexDirection: "row", gap: 4, justifyContent: "flex-end" }}>
          {/* Excel */}
          <TouchableOpacity
            onPress={() => handleDownloadExcel(driver.name, forceStatus)}
            style={{
              borderWidth: 1,
              borderColor: '#3b82f6',
              paddingHorizontal: 6,
              paddingVertical: 4,
              borderRadius: 4,
            }}
          >
            <Text style={{ color: '#3b82f6', fontSize: 10 }}>📥</Text>
          </TouchableOpacity>

          {/* Spoke/Remplacer */}
          {canModify && (
            <TouchableOpacity
              onPress={() => handleUploadSpoke(driver.name)}
              disabled={isUploading}
              style={{
                backgroundColor: driver.isOptimized ? '#22c55e' : '#f59e0b',
                paddingHorizontal: 6,
                paddingVertical: 4,
                borderRadius: 4,
                opacity: isUploading ? 0.6 : 1,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 10 }}>
                {isUploading ? '⏳' : driver.isOptimized ? '🔄' : '📤'}
              </Text>
            </TouchableOpacity>
          )}

          {/* Supprimer */}
          {canDelete && (
            <TouchableOpacity
              onPress={() => handleDelete(driver.name)}
              style={{
                borderWidth: 1,
                borderColor: theme.Colors.danger,
                paddingHorizontal: 6,
                paddingVertical: 4,
                borderRadius: 4,
              }}
            >
              <Text style={{ color: theme.Colors.danger, fontSize: 10 }}>🗑️</Text>
            </TouchableOpacity>
          )}

          {/* Lock pour lecture seule */}
          {!canModify && (
            <Text style={{ color: theme.Colors.muted, fontSize: 10, alignSelf: 'center' }}>🔒</Text>
          )}
        </View>
      </View>
    );
  };

  // Composant pour une section de chauffeurs
  // canModify: permet de modifier (Spoke, Supprimer)
  // forceStatus: force le statut affiché (pour tableaux lecture seule)
  const DriversSection = ({ title, subtitle, driversList, color, canModify = true, forceStatus = null }: { title: string; subtitle?: string; driversList: MutualizedDriver[]; color: string; canModify?: boolean; forceStatus?: 'gofo' | 'cainiao' | null }) => {
    if (driversList.length === 0) return null;

    return (
      <View style={{ marginBottom: theme.Spacing.lg }}>
        <View
          style={{
            backgroundColor: color,
            padding: theme.Spacing.sm,
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
            {title} ({driversList.length})
          </Text>
          {subtitle && (
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 10, marginTop: 2 }}>
              {subtitle}
            </Text>
          )}
        </View>
        <View
          style={{
            borderWidth: 1,
            borderTopWidth: 0,
            borderColor: color,
            borderBottomLeftRadius: 12,
            borderBottomRightRadius: 12,
            overflow: 'hidden',
          }}
        >
          {driversList.map((driver, index) => (
            <DriverRow key={driver.name} driver={driver} canModify={canModify} forceStatus={forceStatus} />
          ))}
        </View>
      </View>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>🚚 Mes Tournées</Text>
      <Text style={{ color: theme.Colors.muted, marginBottom: theme.Spacing.sm }}>
        Gérez vos tournées et importez vos fichiers optimisés.
      </Text>
      <Text style={{ color: theme.Colors.muted, fontSize: 11, marginBottom: theme.Spacing.lg }}>
        Sous-traitant : {currentUser?.sousTraitantName || "Non défini"}
      </Text>

      {/* Sélecteur de date + Rafraîchir */}
      <View style={{ marginBottom: theme.Spacing.lg }}>
        <Text style={{ marginBottom: theme.Spacing.xs, fontWeight: "600", color: theme.Colors.text }}>
          Date des tournées
        </Text>
        <View style={{ flexDirection: 'row', gap: theme.Spacing.sm }}>
          <TouchableOpacity onPress={openDatePicker} style={{ flex: 1 }}>
            <View style={[styles.input, { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 0 }]}>
              <Text style={{ color: theme.Colors.text }}>{formatDateToFrench(selectedDate)}</Text>
              <Text>📅</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => loadDrivers(selectedDate)}
            style={{
              backgroundColor: theme.Colors.primary,
              paddingHorizontal: theme.Spacing.md,
              borderRadius: 10,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '600' }}>🔄</Text>
          </TouchableOpacity>
        </View>

        {showDatePicker && (
          <DateTimePicker
            value={internalDate}
            mode="date"
            display="default"
            onChange={onDateChange}
          />
        )}
      </View>

      {/* Section Import de tournée */}
      <View
        style={{
          backgroundColor: theme.Colors.surfaceMuted,
          borderLeftWidth: 4,
          borderLeftColor: '#f59e0b',
          borderRadius: 12,
          padding: theme.Spacing.md,
          marginBottom: theme.Spacing.lg,
        }}
      >
        <Text style={{ fontSize: 14, fontWeight: '600', color: theme.Colors.text, marginBottom: theme.Spacing.xs }}>
          📥 Importer une nouvelle tournée
        </Text>
        <Text style={{ fontSize: 11, color: theme.Colors.muted, marginBottom: theme.Spacing.md }}>
          PDF Spoke ou Excel avec tracking
        </Text>
        
        <TouchableOpacity
          onPress={handleSelectAndImportFile}
          disabled={importLoading}
          style={{
            backgroundColor: '#f59e0b',
            padding: theme.Spacing.md,
            borderRadius: 8,
            alignItems: 'center',
            opacity: importLoading ? 0.6 : 1,
          }}
        >
          {importLoading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '600' }}>Import en cours...</Text>
            </View>
          ) : (
            <Text style={{ color: '#fff', fontWeight: '600' }}>📄 Choisir un fichier PDF/Excel</Text>
          )}
        </TouchableOpacity>
        
        <Text style={{ fontSize: 10, color: theme.Colors.muted, marginTop: theme.Spacing.sm, fontStyle: 'italic' }}>
          ⚠️ Les doublons de tracking seront détectés automatiquement
        </Text>
      </View>

      {/* Stats */}
      <View style={{ flexDirection: 'row', gap: theme.Spacing.sm, marginBottom: theme.Spacing.lg }}>
        <View style={{ flex: 1, backgroundColor: theme.Colors.primarySoft, borderRadius: 12, padding: theme.Spacing.md, alignItems: 'center' }}>
          <Text style={{ fontSize: 24, fontWeight: '700', color: theme.Colors.primary }}>{drivers.length}</Text>
          <Text style={{ fontSize: 11, color: theme.Colors.muted }}>Chauffeur(s)</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: theme.Colors.surface, borderRadius: 12, padding: theme.Spacing.md, alignItems: 'center', borderWidth: 1, borderColor: theme.Colors.subtleBorder }}>
          <Text style={{ fontSize: 24, fontWeight: '700', color: theme.Colors.text }}>{totalColis}</Text>
          <Text style={{ fontSize: 11, color: theme.Colors.muted }}>{totalGofo} Gofo + {totalCaniao} Cainiao</Text>
        </View>
      </View>

      {/* Bouton Restaurer */}
      <TouchableOpacity
        onPress={handleRestoreDeleted}
        style={{
          backgroundColor: '#22c55e',
          padding: theme.Spacing.md,
          borderRadius: 8,
          marginBottom: theme.Spacing.lg,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '600' }}>♻️ Restaurer tournées supprimées</Text>
      </TouchableOpacity>

      {loading && (
        <View style={{ alignItems: "center", paddingVertical: theme.Spacing.lg }}>
          <ActivityIndicator size="large" color={theme.Colors.primary} />
        </View>
      )}

      {error && (
        <View style={{
          backgroundColor: "#FEE2E2",
          borderLeftWidth: 4,
          borderLeftColor: theme.Colors.danger,
          borderRadius: 8,
          padding: theme.Spacing.md,
          marginBottom: theme.Spacing.md,
        }}>
          <Text style={{ color: theme.Colors.danger, fontSize: 12, fontWeight: "500" }}>{error}</Text>
        </View>
      )}

      {message && (
        <View style={{
          backgroundColor: "#DCFCE7",
          borderLeftWidth: 4,
          borderLeftColor: theme.Colors.success,
          borderRadius: 8,
          padding: theme.Spacing.md,
          marginBottom: theme.Spacing.md,
        }}>
          <Text style={{ color: theme.Colors.success, fontSize: 12, fontWeight: "500" }}>{message}</Text>
        </View>
      )}

      {/* Sections de chauffeurs */}
      <DriversSection 
        title="✅ Mutualisés / Optimisés" 
        subtitle="Gofo + Cainiao combinés ou tournées ajoutées"
        driversList={mutualizedDrivers} 
        color="#22c55e" 
        canModify={true}
      />
      <DriversSection 
        title="🔵 Tournées Gofo" 
        subtitle="Importées depuis Gofo (lecture seule)"
        driversList={gofoOnlyDrivers} 
        color="#3b82f6" 
        canModify={false}
        forceStatus="gofo"
      />
      <DriversSection 
        title="🟣 Tournées Cainiao" 
        subtitle="Importées depuis Cainiao (lecture seule)"
        driversList={caniaoOnlyDrivers} 
        color="#8b5cf6" 
        canModify={false}
        forceStatus="cainiao"
      />

      {drivers.length === 0 && !loading && (
        <View style={{
          backgroundColor: theme.Colors.surfaceMuted,
          borderRadius: 8,
          padding: theme.Spacing.lg,
          alignItems: "center",
        }}>
          <Text style={{ fontSize: 13, color: theme.Colors.muted, fontStyle: "italic" }}>
            Aucune tournée pour cette date
          </Text>
        </View>
      )}

      {/* Bouton Retour */}
      <View style={{
        backgroundColor: theme.Colors.surfaceMuted,
        borderTopWidth: 1,
        borderTopColor: theme.Colors.subtleBorder,
        paddingTop: theme.Spacing.lg,
        marginTop: theme.Spacing.lg,
      }}>
        <AppButton title="← Retour" onPress={onBack} />
      </View>
    </ScrollView>
  );
}




// ===============
// STYLES
// ===============

const styles = StyleSheet.create({
  container: {
    paddingTop: 48,
    paddingHorizontal: theme.Spacing.md,
    paddingBottom: 120,
  },
  title: {
    fontSize: theme.Typography.h1,
    marginBottom: theme.Spacing.sm,
    color: theme.Colors.text,
    fontWeight: "700",
  },
  input: {
    borderWidth: 1,
    borderColor: theme.Colors.subtleBorder,
    padding: theme.Spacing.sm,
    marginBottom: theme.Spacing.sm,
    borderRadius: 10,
    backgroundColor: theme.Colors.surface,
  },
  error: {
    color: theme.Colors.danger,
    marginBottom: 8,
  },
  infoBox: {
    borderWidth: 1,
    borderColor: theme.Colors.subtleBorder,
    padding: theme.Spacing.sm,
    borderRadius: 12,
    marginBottom: theme.Spacing.sm,
    backgroundColor: theme.Colors.card,
  },
  highlightBox: {
    backgroundColor: theme.Colors.primary,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: "center",
    marginBottom: 8,
  },
  orderLabel: {
    fontSize: theme.Typography.small,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "white",
    marginBottom: 4,
  },
  orderNumber: {
    fontSize: 40,
    fontWeight: "800",
    color: "white",
    marginBottom: 12,
  },
  chauffeurLabel: {
    fontSize: theme.Typography.small,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "white",
    marginBottom: 4,
  },
  chauffeurName: {
    fontSize: 24,
    fontWeight: "700",
    color: "white",
  },
});
