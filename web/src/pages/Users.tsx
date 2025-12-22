import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createUser, deleteUser, getUsers, updateUser, type UserDTO } from '../lib/api'
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export function Users() {
  const { user: authUser, token } = useAuth()
  
  // Attendre que l'authentification soit chargée
  if (!token || !authUser) {
    return (
      <div className="stack">
        <div className="surface">
          <p className="muted">Chargement…</p>
        </div>
      </div>
    )
  }
  
  // Si c'est un DISPATCHER, afficher uniquement son profil
  if (authUser.role === 'DISPATCHER') {
    return <MyProfile />
  }
  
  // Sinon, afficher la page admin complète
  return <AdminUsersPage />
}

// =====================
// PAGE "MON PROFIL" POUR DISPATCHER
// =====================
function MyProfile() {
  const { user: authUser, token } = useAuth()
  const qc = useQueryClient()
  
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const updatePasswordMutation = useMutation({
    mutationFn: async () => {
      if (!newPassword) throw new Error('Le nouveau mot de passe est requis')
      if (newPassword.length < 4) throw new Error('Le mot de passe doit faire au moins 4 caractères')
      if (newPassword !== confirmPassword) throw new Error('Les mots de passe ne correspondent pas')
      
      // Appeler la route /api/profile/password
      const api = await import('../lib/api').then(m => m.api)
      const response = await api.put('/api/profile/password', { password: newPassword })
      return response.data
    },
    onSuccess: () => {
      setNewPassword('')
      setConfirmPassword('')
      setError(null)
      setMessage('✅ Mot de passe modifié avec succès !')
      setTimeout(() => setMessage(null), 5000)
    },
    onError: (err: any) => {
      setMessage(null)
      setError(err?.response?.data?.message || err?.message || 'Erreur lors de la modification')
    },
  })

  return (
    <div className="stack">
      <div className="surface">
        <h1 className="title">👤 Mon profil</h1>
        <p className="muted">Gérez vos informations personnelles.</p>
      </div>

      {/* Informations du compte */}
      <div className="surface">
        <p className="card-title">Informations du compte</p>
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <span className="muted" style={{ width: 120 }}>Login :</span>
            <strong>{authUser?.login}</strong>
          </div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <span className="muted" style={{ width: 120 }}>Rôle :</span>
            <span className="pill" style={{ background: '#3e4d2d' }}>
              🚚 DISPATCHER
            </span>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <span className="muted" style={{ width: 120 }}>Sous-traitant :</span>
            <strong>{authUser?.sousTraitantName || '-'}</strong>
          </div>
        </div>
      </div>

      {/* Modification du mot de passe */}
      <div className="surface">
        <p className="card-title">🔒 Modifier mon mot de passe</p>
        
        {message && (
          <div style={{ 
            background: 'rgba(34, 197, 94, 0.1)', 
            border: '1px solid rgba(34, 197, 94, 0.3)',
            borderRadius: 8,
            padding: 12,
            marginTop: 12,
            color: '#22c55e'
          }}>
            {message}
          </div>
        )}
        
        {error && (
          <div style={{ 
            background: 'rgba(239, 68, 68, 0.1)', 
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 8,
            padding: 12,
            marginTop: 12,
            color: '#ef4444'
          }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 16, maxWidth: 400 }}>
          <div className="input-group" style={{ marginBottom: 12 }}>
            <label>Nouveau mot de passe</label>
            <input 
              type="password" 
              value={newPassword} 
              onChange={(e) => setNewPassword(e.target.value)} 
              placeholder="Entrez votre nouveau mot de passe"
            />
          </div>
          <div className="input-group" style={{ marginBottom: 16 }}>
            <label>Confirmer le mot de passe</label>
            <input 
              type="password" 
              value={confirmPassword} 
              onChange={(e) => setConfirmPassword(e.target.value)} 
              placeholder="Confirmez votre nouveau mot de passe"
            />
          </div>
          <button 
            className="btn" 
            onClick={() => updatePasswordMutation.mutate()} 
            disabled={updatePasswordMutation.isPending || !newPassword || !confirmPassword}
          >
            {updatePasswordMutation.isPending ? 'Modification…' : 'Modifier le mot de passe'}
          </button>
        </div>
      </div>
    </div>
  )
}

// =====================
// PAGE ADMIN UTILISATEURS (inchangée)
// =====================
function AdminUsersPage() {
  const [activeTab, setActiveTab] = useState<'users' | 'chauffeurs'>('users')
  
  return (
    <div className="stack">
      <div className="surface">
        <h1 className="title">👥 Gestion</h1>
        <p className="muted">Gérez les utilisateurs, chauffeurs et sous-traitants.</p>
        
        {/* Onglets */}
        <div style={{ 
          display: 'flex', 
          gap: 4, 
          marginTop: 16,
          background: 'var(--panel)',
          borderRadius: 8,
          padding: 4
        }}>
          <button
            onClick={() => setActiveTab('users')}
            style={{
              flex: 1,
              padding: '10px 16px',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              background: activeTab === 'users' ? 'var(--accent)' : 'transparent',
              color: activeTab === 'users' ? '#fff' : '#aaa',
              fontWeight: activeTab === 'users' ? 'bold' : 'normal',
              transition: 'all 0.2s'
            }}
          >
            👤 Utilisateurs
          </button>
          <button
            onClick={() => setActiveTab('chauffeurs')}
            style={{
              flex: 1,
              padding: '10px 16px',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              background: activeTab === 'chauffeurs' ? 'var(--accent)' : 'transparent',
              color: activeTab === 'chauffeurs' ? '#fff' : '#aaa',
              fontWeight: activeTab === 'chauffeurs' ? 'bold' : 'normal',
              transition: 'all 0.2s'
            }}
          >
            🚗 Chauffeurs
          </button>
        </div>
      </div>

      {activeTab === 'users' ? <UsersTab /> : <ChauffeursTab />}
    </div>
  )
}

// =====================
// ONGLET CHAUFFEURS
// =====================
function ChauffeursTab() {
  const qc = useQueryClient()
  const { token } = useAuth()
  
  // Récupérer les chauffeurs
  const { data: chauffeursData, isLoading, error, refetch } = useQuery({
    queryKey: ['chauffeurs'],
    queryFn: async () => {
      const api = await import('../lib/api').then(m => m.api)
      const res = await api.get('/api/chauffeurs')
      return res.data
    },
    enabled: !!token,
  })
  
  const chauffeurs = chauffeursData?.chauffeurs || []
  const sousTraitants = chauffeursData?.sousTraitants || []
  
  // États pour l'ajout
  const [newChauffeur, setNewChauffeur] = useState('')
  const [newST, setNewST] = useState('')
  const [showNewST, setShowNewST] = useState(false)
  const [newSTName, setNewSTName] = useState('')
  
  // États pour l'édition
  const [editingChauffeur, setEditingChauffeur] = useState<string | null>(null)
  const [editST, setEditST] = useState('')
  
  // État pour le filtre
  const [filterST, setFilterST] = useState<string>('TOUS')
  
  // Mutation pour ajouter un chauffeur
  const addMutation = useMutation({
    mutationFn: async () => {
      const api = await import('../lib/api').then(m => m.api)
      
      let finalST = newST
      
      // Créer le sous-traitant si nécessaire
      if (showNewST && newSTName.trim()) {
        await api.post('/api/sous-traitants', { name: newSTName.trim() })
        finalST = newSTName.trim()
      }
      
      if (!newChauffeur.trim()) throw new Error('Nom du chauffeur requis')
      if (!finalST) throw new Error('Sous-traitant requis')
      
      await api.post('/api/chauffeurs', { 
        name: newChauffeur.trim(), 
        sousTraitant: finalST 
      })
    },
    onSuccess: () => {
      setNewChauffeur('')
      setNewST('')
      setShowNewST(false)
      setNewSTName('')
      refetch()
      qc.invalidateQueries({ queryKey: ['sous-traitants'] })
    },
    onError: (err: any) => {
      alert(err?.response?.data?.message || err?.message || 'Erreur')
    },
  })
  
  // Mutation pour modifier un chauffeur
  const updateMutation = useMutation({
    mutationFn: async (chauffeurName: string) => {
      const api = await import('../lib/api').then(m => m.api)
      await api.put(`/api/chauffeurs/${encodeURIComponent(chauffeurName)}`, {
        sousTraitant: editST
      })
    },
    onSuccess: () => {
      setEditingChauffeur(null)
      setEditST('')
      refetch()
    },
    onError: (err: any) => {
      alert(err?.response?.data?.message || err?.message || 'Erreur')
    },
  })
  
  // Mutation pour supprimer un chauffeur
  const deleteMutation = useMutation({
    mutationFn: async (chauffeurName: string) => {
      const api = await import('../lib/api').then(m => m.api)
      await api.delete(`/api/chauffeurs/${encodeURIComponent(chauffeurName)}`)
    },
    onSuccess: () => {
      refetch()
    },
    onError: (err: any) => {
      alert(err?.response?.data?.message || err?.message || 'Erreur')
    },
  })
  
  // Mutation pour supprimer un sous-traitant
  const deleteSTMutation = useMutation({
    mutationFn: async (stName: string) => {
      const api = await import('../lib/api').then(m => m.api)
      await api.delete(`/api/sous-traitants/${encodeURIComponent(stName)}`)
    },
    onSuccess: () => {
      refetch()
      qc.invalidateQueries({ queryKey: ['sous-traitants'] })
    },
    onError: (err: any) => {
      alert(err?.response?.data?.message || err?.message || 'Erreur')
    },
  })
  
  // Mutation pour créer un sous-traitant seul
  const [newSTOnly, setNewSTOnly] = useState('')
  const createSTMutation = useMutation({
    mutationFn: async () => {
      const api = await import('../lib/api').then(m => m.api)
      if (!newSTOnly.trim()) throw new Error('Nom requis')
      await api.post('/api/sous-traitants', { name: newSTOnly.trim() })
    },
    onSuccess: () => {
      setNewSTOnly('')
      refetch()
      qc.invalidateQueries({ queryKey: ['sous-traitants'] })
    },
    onError: (err: any) => {
      alert(err?.response?.data?.message || err?.message || 'Erreur')
    },
  })
  
  // Filtrer les chauffeurs
  const filteredChauffeurs = filterST === 'TOUS' 
    ? chauffeurs 
    : chauffeurs.filter((c: any) => c.sousTraitant === filterST)
  
  // Grouper par sous-traitant pour l'affichage
  const groupedByST: Record<string, any[]> = {}
  filteredChauffeurs.forEach((c: any) => {
    if (!groupedByST[c.sousTraitant]) {
      groupedByST[c.sousTraitant] = []
    }
    groupedByST[c.sousTraitant].push(c)
  })

  return (
    <>
      {/* Ajouter un chauffeur */}
      <div className="surface">
        <p className="card-title">➕ Ajouter un chauffeur</p>
        <div className="grid two" style={{ marginTop: 12 }}>
          <div className="input-group">
            <label>Nom du chauffeur</label>
            <input
              value={newChauffeur}
              onChange={(e) => setNewChauffeur(e.target.value)}
              placeholder="Ex: Lucas, Mohammed, Pierre..."
            />
          </div>
          <div className="input-group">
            <label>Sous-traitant</label>
            {!showNewST ? (
              <>
                <select value={newST} onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setShowNewST(true)
                    setNewST('')
                  } else {
                    setNewST(e.target.value)
                  }
                }}>
                  <option value="">-- Choisir --</option>
                  {sousTraitants.map((st: string) => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                  <option value="__new__">+ Nouveau sous-traitant...</option>
                </select>
              </>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={newSTName}
                  onChange={(e) => setNewSTName(e.target.value)}
                  placeholder="Nom du sous-traitant"
                  style={{ flex: 1 }}
                />
                <button 
                  className="ghost-btn" 
                  onClick={() => { setShowNewST(false); setNewSTName('') }}
                  style={{ padding: '8px' }}
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </div>
        <button 
          className="btn" 
          style={{ marginTop: 12 }}
          onClick={() => addMutation.mutate()}
          disabled={addMutation.isPending || !newChauffeur.trim() || (!newST && !newSTName.trim())}
        >
          {addMutation.isPending ? 'Ajout...' : 'Ajouter le chauffeur'}
        </button>
      </div>
      
      {/* Gérer les sous-traitants */}
      <div className="surface">
        <p className="card-title">🏢 Sous-traitants ({sousTraitants.length})</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {sousTraitants.map((st: string) => {
            const count = chauffeurs.filter((c: any) => c.sousTraitant === st).length
            return (
              <div 
                key={st}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'var(--panel)',
                  padding: '8px 12px',
                  borderRadius: 6,
                }}
              >
                <strong>{st}</strong>
                <span className="pill" style={{ background: '#444', fontSize: 11 }}>
                  {count} chauffeur{count > 1 ? 's' : ''}
                </span>
                {count === 0 && (
                  <button
                    className="ghost-btn"
                    style={{ padding: '2px 6px', fontSize: 11, color: '#f87b7b' }}
                    onClick={() => {
                      if (window.confirm(`Supprimer le sous-traitant "${st}" ?`)) {
                        deleteSTMutation.mutate(st)
                      }
                    }}
                  >
                    🗑️
                  </button>
                )}
              </div>
            )
          })}
        </div>
        
        {/* Ajouter un sous-traitant seul */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, maxWidth: 400 }}>
          <input
            value={newSTOnly}
            onChange={(e) => setNewSTOnly(e.target.value)}
            placeholder="Nouveau sous-traitant..."
            style={{ flex: 1 }}
          />
          <button
            className="btn"
            onClick={() => createSTMutation.mutate()}
            disabled={createSTMutation.isPending || !newSTOnly.trim()}
          >
            {createSTMutation.isPending ? '...' : '+ Ajouter'}
          </button>
        </div>
      </div>
      
      {/* Liste des chauffeurs */}
      <div className="surface">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p className="card-title" style={{ margin: 0 }}>🚗 Chauffeurs ({filteredChauffeurs.length})</p>
          <select 
            value={filterST} 
            onChange={(e) => setFilterST(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="TOUS">Tous les sous-traitants</option>
            {sousTraitants.map((st: string) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
        </div>
        
        {isLoading && <p className="muted">Chargement...</p>}
        {error && <p style={{ color: '#f87b7b' }}>Erreur de chargement</p>}
        
        {!isLoading && filteredChauffeurs.length === 0 && (
          <p className="muted">Aucun chauffeur enregistré.</p>
        )}
        
        {!isLoading && Object.keys(groupedByST).length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {Object.entries(groupedByST).map(([st, drivers]) => (
              <div key={st}>
                <p style={{ 
                  fontSize: 13, 
                  fontWeight: 'bold', 
                  color: '#7c3aed', 
                  marginBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}>
                  🏢 {st}
                  <span style={{ 
                    fontSize: 11, 
                    fontWeight: 'normal', 
                    color: '#888' 
                  }}>
                    ({drivers.length} chauffeur{drivers.length > 1 ? 's' : ''})
                  </span>
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Nom</th>
                      <th>Ajouté le</th>
                      <th style={{ width: 150 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {drivers.map((c: any) => (
                      <tr key={c.name}>
                        <td>
                          <strong>{c.name}</strong>
                          {c.normalized && c.normalized !== c.name.toLowerCase() && (
                            <span style={{ fontSize: 11, color: '#666', marginLeft: 8 }}>
                              ({c.normalized})
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: 12, color: '#888' }}>
                          {c.createdAt ? new Date(c.createdAt).toLocaleDateString('fr-FR') : '-'}
                        </td>
                        <td>
                          {editingChauffeur === c.name ? (
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <select
                                value={editST}
                                onChange={(e) => setEditST(e.target.value)}
                                style={{ flex: 1, fontSize: 12 }}
                              >
                                {sousTraitants.map((s: string) => (
                                  <option key={s} value={s}>{s}</option>
                                ))}
                              </select>
                              <button
                                className="btn"
                                style={{ fontSize: 11, padding: '4px 8px' }}
                                onClick={() => updateMutation.mutate(c.name)}
                                disabled={updateMutation.isPending}
                              >
                                ✓
                              </button>
                              <button
                                className="ghost-btn"
                                style={{ fontSize: 11, padding: '4px 8px' }}
                                onClick={() => setEditingChauffeur(null)}
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                className="ghost-btn"
                                style={{ fontSize: 11, padding: '4px 8px' }}
                                onClick={() => {
                                  setEditingChauffeur(c.name)
                                  setEditST(c.sousTraitant)
                                }}
                              >
                                ✏️ Modifier
                              </button>
                              <button
                                className="ghost-btn"
                                style={{ fontSize: 11, padding: '4px 8px', color: '#f87b7b' }}
                                onClick={() => {
                                  if (window.confirm(`Supprimer le chauffeur "${c.name}" ?`)) {
                                    deleteMutation.mutate(c.name)
                                  }
                                }}
                              >
                                🗑️
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// =====================
// ONGLET UTILISATEURS
// =====================
function UsersTab() {
  const qc = useQueryClient()
  const { user: authUser, token } = useAuth()
  
  const { data, isLoading, error } = useQuery<UserDTO[]>({
    queryKey: ['users'],
    queryFn: getUsers,
    enabled: !!token,
  })
  
  // Récupérer la liste des sous-traitants existants
  const { data: sousTraitantsData } = useQuery({
    queryKey: ['sous-traitants'],
    queryFn: async () => {
      const res = await import('../lib/api').then(m => m.getSousTraitants())
      // Gérer les différents formats de retour possibles
      if (Array.isArray(res)) return res
      if (res?.sousTraitants && Array.isArray(res.sousTraitants)) return res.sousTraitants
      return []
    },
    enabled: !!token,
  })
  const sousTraitants = Array.isArray(sousTraitantsData) ? sousTraitantsData : []

  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserDTO['role']>('DISPATCHER')
  const [sousTraitantName, setSousTraitantName] = useState<string>('')
  // Ajout d'un état pour la saisie du nouveau sous-traitant
  const [newSousTraitantName, setNewSousTraitantName] = useState('')

  const [editingLogin, setEditingLogin] = useState<string | null>(null)
  const [editRole, setEditRole] = useState<UserDTO['role']>('DISPATCHER')
  const [editSousTraitant, setEditSousTraitant] = useState<string>('')
  // Pour la saisie d'un nouveau sous-traitant lors de l'édition
  const [editNewSousTraitantName, setEditNewSousTraitantName] = useState('')
  const [editPassword, setEditPassword] = useState<string>('')
  const [editLogin, setEditLogin] = useState<string>('')

  const addMutation = useMutation({
    mutationFn: () => {
      let sousTraitantToSend = null;
      if (role !== 'ADMIN') {
        sousTraitantToSend = sousTraitantName === '__new__' ? newSousTraitantName.trim() : sousTraitantName || null;
      }
      return createUser({ login, password, role, sousTraitantName: sousTraitantToSend });
    },
    onSuccess: () => {
      setLogin('')
      setPassword('')
      setSousTraitantName('')
      setNewSousTraitantName('')
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const delMutation = useMutation({
    mutationFn: (loginToDelete: string) => deleteUser(loginToDelete),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editingLogin) return

      // Protection et confirmation pour changement de rôle ADMIN → non-ADMIN
      const admins = (data || []).filter(u => u.role === 'ADMIN')
      const isEditingAdmin = (data || []).find(u => u.login === editingLogin)?.role === 'ADMIN'
      const isSelf = authUser?.login === editingLogin
      const roleBecomesNonAdmin = editRole !== 'ADMIN'

      if (isEditingAdmin && roleBecomesNonAdmin) {
        if (admins.length <= 1) {
          alert("Impossible de retirer le rôle ADMIN au seul administrateur. Créez un autre ADMIN avant.")
          return
        }
        const confirmed = window.confirm(
          "⚠️ Vous êtes sur le point de retirer le rôle ADMIN. Cette action est irréversible. Confirmez-vous ?"
        )
        if (!confirmed) return
      }

      let sousTraitantToSend = null;
      if (editRole !== 'ADMIN') {
        sousTraitantToSend = editSousTraitant === '__new__' ? editNewSousTraitantName.trim() : editSousTraitant || null;
      }
      await updateUser(editingLogin, {
        login: editLogin,
        role: editRole,
        sousTraitantName: sousTraitantToSend,
        password: editPassword || undefined,
      })
    },
    onSuccess: () => {
      setEditingLogin(null)
      setEditPassword('')
      setEditLogin('')
      setEditSousTraitant('')
      setEditNewSousTraitantName('')
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })

  return (
    <div className="stack">
      <div className="surface">
        <h1 className="title">Utilisateurs</h1>
        <p className="muted">Gestion des comptes (ADMIN requis).</p>
      </div>

      <div className="surface">
        <p className="card-title">Ajouter un utilisateur</p>
        <div className="grid two" style={{ marginTop: 12 }}>
          <div className="input-group">
            <label>Login</label>
            <input value={login} onChange={(e) => setLogin(e.target.value)} />
          </div>
          <div className="input-group">
            <label>Mot de passe</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="input-group">
            <label>Rôle</label>
            <select value={role} onChange={(e) => setRole(e.target.value as UserDTO['role'])}>
              <option value="ADMIN">ADMIN</option>
              <option value="DISPATCHER">DISPATCHER</option>
              <option value="TRIEUR">TRIEUR</option>
            </select>
          </div>
          <div className="input-group">
            <label>Sous-traitant (non applicable pour ADMIN)</label>
            {role === 'ADMIN' ? (
              <input
                value=""
                disabled
                placeholder="Les admins n'ont pas de sous-traitant"
              />
            ) : (
              <>
                <select
                  value={sousTraitantName}
                  onChange={e => {
                    setSousTraitantName(e.target.value);
                    if (e.target.value === '__new__') setNewSousTraitantName('');
                  }}
                >
                  <option value="">-- Sélectionner --</option>
                  {sousTraitants.map(st => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                  <option value="__new__">+ Nouveau sous-traitant…</option>
                </select>
                {/* Champ pour ajouter un nouveau sous-traitant si besoin */}
                {sousTraitantName === '__new__' && (
                  <input
                    autoFocus
                    placeholder="Nom du nouveau sous-traitant"
                    value={newSousTraitantName}
                    onChange={e => setNewSousTraitantName(e.target.value)}
                  />
                )}
              </>
            )}
          </div>
        </div>
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !login || !password}>
            {addMutation.isPending ? 'Ajout…' : 'Ajouter'}
          </button>
        </div>
      </div>

      <div className="surface">
        <p className="card-title">Liste des utilisateurs</p>
        {isLoading && <p className="muted">Chargement…</p>}
        {error && <p className="muted" style={{ color: '#f87b7b' }}>Erreur: {(error as any)?.response?.data?.message || (error as any)?.message}</p>}
        {!isLoading && !error && (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Login</th>
                <th>Rôle</th>
                <th>Sous-traitant</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data?.map((u) => (
                <tr key={u.login}>
                  <td style={{ verticalAlign: 'top' }}>{u.login}</td>
                  <td style={{ verticalAlign: 'top' }}>
                    {u.role === 'ADMIN' && (
                      <span className="pill" style={{ background: '#7b61ff', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span aria-hidden>🛡️</span>
                        <span>ADMIN</span>
                      </span>
                    )}
                    {u.role === 'DISPATCHER' && (
                      <span className="pill" style={{ background: '#3e4d2d', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span aria-hidden>🚚</span>
                        <span>DISPATCHER</span>
                      </span>
                    )}
                    {u.role === 'TRIEUR' && (
                      <span className="pill" style={{ background: '#2d4d4d', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span aria-hidden>🔧</span>
                        <span>TRIEUR</span>
                      </span>
                    )}
                  </td>
                  <td style={{ verticalAlign: 'top' }}>{u.sousTraitantName || '-'}</td>
                  <td style={{ verticalAlign: 'top' }}>
                    {editingLogin === u.login ? (
                      <div className="stack" style={{ gap: 8 }}>
                        <div className="input-group">
                          <label>Login</label>
                          <input
                            value={editLogin}
                            onChange={e => setEditLogin(e.target.value)}
                            placeholder="Login"
                          />
                        </div>
                        <div className="input-group">
                          <label>Rôle</label>
                          <select
                            value={editRole}
                            onChange={(e) => setEditRole(e.target.value as UserDTO['role'])}
                            disabled={(() => {
                              const admins = (data || []).filter(x => x.role === 'ADMIN')
                              const isSelf = authUser?.login === u.login
                              const isAdminRow = u.role === 'ADMIN'
                              return isAdminRow && isSelf && admins.length <= 1
                            })()}
                            title={(() => {
                              const admins = (data || []).filter(x => x.role === 'ADMIN')
                              const isSelf = authUser?.login === u.login
                              const isAdminRow = u.role === 'ADMIN'
                              if (isAdminRow && isSelf && admins.length <= 1) {
                                return "Grisé: impossible de changer le rôle du seul ADMIN."
                              }
                              return ''
                            })()}
                          >
                            <option value="ADMIN">ADMIN</option>
                            <option value="DISPATCHER">DISPATCHER</option>
                            <option value="TRIEUR">TRIEUR</option>
                          </select>
                        </div>
                        <div className="input-group">
                          <label>Sous-traitant</label>
                          {editRole === 'ADMIN' ? (
                            <input
                              value=""
                              disabled
                              placeholder="Les admins n'ont pas de sous-traitant"
                            />
                          ) : (
                            <>
                              <select
                                value={editSousTraitant}
                                onChange={e => {
                                  setEditSousTraitant(e.target.value);
                                  if (e.target.value === '__new__') setEditNewSousTraitantName('');
                                }}
                              >
                                <option value="">-- Sélectionner --</option>
                                {sousTraitants.map(st => (
                                  <option key={st} value={st}>{st}</option>
                                ))}
                                <option value="__new__">+ Nouveau sous-traitant…</option>
                              </select>
                              {editSousTraitant === '__new__' && (
                                <input
                                  autoFocus
                                  placeholder="Nom du nouveau sous-traitant"
                                  value={editNewSousTraitantName}
                                  onChange={e => setEditNewSousTraitantName(e.target.value)}
                                />
                              )}
                            </>
                          )}
                        </div>
                        <div className="input-group">
                          <label>Mot de passe (optionnel)</label>
                          <input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} />
                        </div>
                        <div className="actions">
                          <button className="btn" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                            {saveMutation.isPending ? 'Sauvegarde…' : 'Sauvegarder'}
                          </button>
                          <button className="ghost-btn" onClick={() => setEditingLogin(null)}>Annuler</button>
                        </div>
                      </div>
                    ) : (
                      <div className="actions" style={{ gap: 8 }}>
                        <button
                          className="ghost-btn"
                          onClick={() => {
                            setEditingLogin(u.login)
                            setEditLogin(u.login)
                            setEditRole(u.role)
                            setEditSousTraitant(u.sousTraitantName || '')
                            setEditPassword('')
                          }}
                        >
                          Modifier
                        </button>
                        <button
                          className="ghost-btn"
                          onClick={() => {
                            const admins = (data || []).filter(x => x.role === 'ADMIN')
                            const isAdmin = u.role === 'ADMIN'
                            if (isAdmin) {
                              if (admins.length <= 1) {
                                alert("Impossible de supprimer l'unique administrateur. Créez un autre ADMIN avant.")
                                return
                              }
                              const confirmed = window.confirm(
                                "⚠️ Vous allez supprimer un compte ADMIN. Cette action est irréversible. Confirmez-vous ?"
                              )
                              if (!confirmed) return
                            }
                            delMutation.mutate(u.login)
                          }}
                          disabled={delMutation.isPending}
                        >
                          Supprimer
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
