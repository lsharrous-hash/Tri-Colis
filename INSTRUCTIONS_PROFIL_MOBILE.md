# Ajout de la fonctionnalité "Mon Profil" sur l'app mobile

## Instructions pas à pas

---

## ÉTAPE 1 : Ajouter "PROFILE" au type Screen (ligne ~74)

Cherche cette ligne dans `App.tsx` :
```typescript
type Screen =
  | "ROLE_HOME"
  | "TRI_HOME"
  ...
  | "ADMIN_USERS";
```

Ajoute `| "PROFILE"` à la fin :
```typescript
type Screen =
  | "ROLE_HOME"
  | "TRI_HOME"
  | "TRI_SCAN"
  | "DISPATCHER_HOME"
  | "DISPATCHER_IMPORT"
  | "DISPATCHER_TOURS"
  | "ADMIN_HOME"
  | "ADMIN_TOURS"
  | "ADMIN_USERS"
  | "PROFILE";    // <-- AJOUTER CETTE LIGNE
```

---

## ÉTAPE 2 : Modifier RoleHomeProps (ligne ~393)

Cherche :
```typescript
interface RoleHomeProps {
  user: User;
  onLogout: () => void;
  onGoToTri: () => void;
  onGoToDispatcher: () => void;
  onGoToAdmin: () => void;
}
```

Ajoute `onGoToProfile` :
```typescript
interface RoleHomeProps {
  user: User;
  onLogout: () => void;
  onGoToTri: () => void;
  onGoToDispatcher: () => void;
  onGoToAdmin: () => void;
  onGoToProfile: () => void;    // <-- AJOUTER CETTE LIGNE
}
```

---

## ÉTAPE 3 : Modifier RoleHomeScreen (ligne ~401)

Cherche la fonction `RoleHomeScreen` et ajoute `onGoToProfile` dans les paramètres :

```typescript
function RoleHomeScreen({
  user,
  onLogout,
  onGoToTri,
  onGoToDispatcher,
  onGoToAdmin,
  onGoToProfile,    // <-- AJOUTER CETTE LIGNE
}: RoleHomeProps) {
```

---

## ÉTAPE 4 : Ajouter le bouton "Mon profil" dans RoleHomeScreen

Dans la fonction `RoleHomeScreen`, cherche le bloc avec "Se déconnecter" (vers ligne 458) :

```typescript
      <View style={{ flex: 1 }} />
      
      <View style={{
        backgroundColor: theme.Colors.surfaceMuted,
        ...
      }}>
        <Button 
          title="Se déconnecter" 
          ...
        />
      </View>
```

Remplace par :
```typescript
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
```

---

## ÉTAPE 5 : Modifier l'appel à RoleHomeScreen (vers ligne 276)

Cherche où `RoleHomeScreen` est appelé :
```typescript
        <RoleHomeScreen
          user={currentUser}
          onLogout={handleLogout}
          onGoToTri={() => setScreen("TRI_HOME")}
          onGoToDispatcher={() => setScreen("DISPATCHER_HOME")}
          onGoToAdmin={() => setScreen("ADMIN_HOME")}
        />
```

Ajoute `onGoToProfile` :
```typescript
        <RoleHomeScreen
          user={currentUser}
          onLogout={handleLogout}
          onGoToTri={() => setScreen("TRI_HOME")}
          onGoToDispatcher={() => setScreen("DISPATCHER_HOME")}
          onGoToAdmin={() => setScreen("ADMIN_HOME")}
          onGoToProfile={() => setScreen("PROFILE")}    // <-- AJOUTER
        />
```

---

## ÉTAPE 6 : Ajouter l'écran PROFILE (après ADMIN_USERS, vers ligne 372)

Après le bloc :
```typescript
  if (screen === "ADMIN_USERS") {
    ...
  }
```

Ajoute ce nouveau bloc :
```typescript
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
```

---

## ÉTAPE 7 : Ajouter le composant ProfileScreen

Copie ce composant COMPLET à la fin du fichier, AVANT la section `const styles = StyleSheet.create({...})` :

```typescript
// ===============
// PROFILE SCREEN - Gestion du profil utilisateur
// ===============

interface ProfileScreenProps {
  authToken: string;
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

      setMessage('✅ Mot de passe modifié avec succès !');
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
            <Text style={{ fontWeight: '600', fontSize: 14 }}>{currentUser?.login}</Text>
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
              <Text style={{ fontWeight: '600', fontSize: 14 }}>{currentUser.sousTraitantName}</Text>
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
              {message}
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
              }}
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirmez votre nouveau mot de passe"
              placeholderTextColor={theme.Colors.muted}
            />
          </View>

          <Button
            title={loading ? 'Modification...' : 'Modifier le mot de passe'}
            onPress={handleChangePassword}
            disabled={loading || !newPassword || !confirmPassword}
          />
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
```

---

## RÉSUMÉ DES MODIFICATIONS

1. ✅ Ajouter `"PROFILE"` au type `Screen`
2. ✅ Ajouter `onGoToProfile` à `RoleHomeProps`
3. ✅ Ajouter `onGoToProfile` aux paramètres de `RoleHomeScreen`
4. ✅ Ajouter le bouton "Mon profil" dans le JSX de `RoleHomeScreen`
5. ✅ Ajouter `onGoToProfile={() => setScreen("PROFILE")}` dans l'appel à `RoleHomeScreen`
6. ✅ Ajouter le bloc `if (screen === "PROFILE")` 
7. ✅ Ajouter le composant `ProfileScreen` complet

---

## TESTER

1. Relance Expo : `npx expo start -c`
2. Connecte-toi avec n'importe quel compte
3. Tu devrais voir le bouton "👤 Mon profil" sur l'écran d'accueil
4. Clique dessus pour accéder à la page profil
5. Teste la modification du mot de passe
