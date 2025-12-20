import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { uploadTour, uploadTourCaniao, getSousTraitants, getTours, deleteTour, downloadTour, api } from '../lib/api'
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

// =====================
// Types
// =====================
interface MutualizedDriver {
  name: string
  sousTraitant: string | null
  gofoCount: number
  caniaoCount: number
  totalCount: number
  hasBoth: boolean
  isOptimized?: boolean
  isDispatcherImport?: boolean
  gofoCreatedBy?: string | null
}

// =====================
// API Functions
// =====================
async function getMutualizedDrivers(date: string, sousTraitant?: string) {
  const { data } = await api.get('/api/mutualized/drivers', {
    params: { date, sousTraitant }
  })
  return data
}

function downloadMutualizedExcel(driverName: string, date: string, source?: 'gofo' | 'cainiao' | null) {
  try {
    const authData = localStorage.getItem('tricoli.auth')
    if (!authData) {
      alert('Vous devez être connecté pour télécharger')
      return
    }
    const { token } = JSON.parse(authData)
    if (!token) {
      alert('Token manquant, veuillez vous reconnecter')
      return
    }
    let url = `${api.defaults.baseURL}/api/mutualized/driver/${encodeURIComponent(driverName)}/export?date=${date}&token=${encodeURIComponent(token)}`
    if (source) {
      url += `&source=${source}`
    }
    window.open(url, '_blank')
  } catch (e) {
    alert('Erreur lors du téléchargement')
  }
}

async function uploadOptimizedTour(file: File, date: string, driverName: string, sousTraitantName: string) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('date', date)
  formData.append('driverName', driverName)
  formData.append('sousTraitantName', sousTraitantName)
  formData.append('isOptimized', 'true')
  const { data } = await api.post('/api/dispatcher/tour/optimized', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

// =====================
// DISPATCHER VIEW
// =====================
function DispatcherView() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const today = new Date().toISOString().split('T')[0]
  const [selectedDate, setSelectedDate] = useState<string>(today)
  const [uploadingDriver, setUploadingDriver] = useState<string | null>(null)
  
  // Import state
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)

  // Fetch mutualized drivers
  const { data, isLoading, error } = useQuery({
    queryKey: ['mutualized-drivers', selectedDate, user?.sousTraitantName],
    queryFn: () => getMutualizedDrivers(selectedDate, user?.sousTraitantName || undefined),
    enabled: !!selectedDate,
  })

  const drivers: MutualizedDriver[] = data?.drivers || []
  
  // Séparer les chauffeurs
  // Mutualisé/Optimisé : ceux qui ont les deux, sont optimisés, ou importés manuellement par le dispatcher
  const mutualizedDrivers = drivers.filter(d => d.hasBoth || d.isOptimized || d.isDispatcherImport)
  // Gofo : TOUS ceux qui ont du Gofo (y compris optimisées, mais pas les imports manuels sans Gofo original)
  const gofoOnlyDrivers = drivers.filter(d => d.gofoCount > 0 && (!d.isDispatcherImport || d.isOptimized))
  // Cainiao : TOUS ceux qui ont du Cainiao (y compris optimisées, mais pas les imports manuels sans Cainiao original)
  const caniaoOnlyDrivers = drivers.filter(d => d.caniaoCount > 0 && (!d.isDispatcherImport || d.isOptimized))

  // Fonction pour importer un fichier avec une action spécifique
  const importFileWithAction = async (file: File, action?: string, targetDriverName?: string) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('date', selectedDate)
    if (action) formData.append('action', action)
    if (targetDriverName) formData.append('targetDriverName', targetDriverName)
    
    const { data } = await api.post('/api/dispatcher/tours/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  }

  // Import mutation with name matching check
  const importMutation = useMutation({
    mutationFn: async () => {
      if (files.length === 0) throw new Error('Aucun fichier sélectionné')
      if (!selectedDate) throw new Error('Date requise')
      const results = []
      for (const file of files) {
        const result = await importFileWithAction(file)
        results.push(result)
      }
      return results
    },
    onSuccess: (results) => {
      setFiles([])
      qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
      qc.invalidateQueries({ queryKey: ['tours'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      const totalColis = results.reduce((sum, r) => sum + (r.tour?.colisCount || 0), 0)
      alert(`✅ ${results.length} tournée(s) importée(s): ${totalColis} colis`)
    },
    onError: (err: any) => {
      const errorData = err?.response?.data
      
      // Gestion des noms identiques
      if (errorData?.error === 'EXACT_NAME_MATCH') {
        const existingName = errorData.existingDriverName
        const choice = window.confirm(
          `⚠️ Une tournée pour "${existingName}" existe déjà pour cette date.\n\n` +
          `Voulez-vous REMPLACER cette tournée ?\n\n` +
          `• OK = Remplacer la tournée existante\n` +
          `• Annuler = Ajouter comme nouvelle tournée séparée`
        )
        
        // Stocker le fichier en cours et relancer avec l'action choisie
        const currentFile = files[0]
        if (currentFile) {
          const action = choice ? 'replace' : 'addNew'
          importFileWithAction(currentFile, action)
            .then((result) => {
              setFiles(prev => prev.slice(1))
              qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
              qc.invalidateQueries({ queryKey: ['tours'] })
              const driverName = result.tour?.chauffeurName || existingName
              alert(`✅ Tournée ${choice ? 'remplacée' : 'créée'} pour ${driverName}: ${result.tour?.colisCount || 0} colis`)
            })
            .catch((e) => {
              alert(`Erreur: ${e?.response?.data?.message || e?.message}`)
            })
        }
        return
      }
      
      // Gestion des noms similaires
      if (errorData?.error === 'SIMILAR_NAME_MATCH') {
        const existingName = errorData.existingDriverName
        const newName = errorData.newDriverName
        const choice = window.confirm(
          `⚠️ Un chauffeur avec un nom similaire existe: "${existingName}"\n` +
          `Le fichier importé contient: "${newName}"\n\n` +
          `Voulez-vous FUSIONNER avec "${existingName}" ?\n\n` +
          `• OK = Fusionner avec ${existingName}\n` +
          `• Annuler = Créer une nouvelle tournée pour ${newName}`
        )
        
        const currentFile = files[0]
        if (currentFile) {
          const action = choice ? 'useName' : 'addNew'
          const targetName = choice ? existingName : undefined
          importFileWithAction(currentFile, action, targetName)
            .then((result) => {
              setFiles(prev => prev.slice(1))
              qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
              qc.invalidateQueries({ queryKey: ['tours'] })
              const driverName = result.tour?.chauffeurName || (choice ? existingName : newName)
              alert(`✅ Tournée créée pour ${driverName}: ${result.tour?.colisCount || 0} colis`)
            })
            .catch((e) => {
              const errMsg = e?.response?.data
              if (errMsg?.error === 'DUPLICATE_TRACKINGS') {
                alert(`❌ Import annulé: ${errMsg.totalDuplicates} tracking(s) déjà présent(s)`)
              } else {
                alert(`Erreur: ${errMsg?.message || e?.message}`)
              }
            })
        }
        return
      }
      
      // Gestion des doublons de tracking
      if (errorData?.error === 'DUPLICATE_TRACKINGS') {
        const duplicates = errorData.duplicates || []
        const total = errorData.totalDuplicates || duplicates.length
        const displayList = duplicates.slice(0, 10).join('\n')
        alert(`❌ Import annulé: ${total} tracking(s) déjà présent(s)\n\nExemples:\n${displayList}${total > 10 ? '\n...' : ''}`)
      } else {
        const msg = errorData?.message || err?.message || 'Erreur inconnue'
        alert(`Erreur d'import: ${msg}`)
      }
    },
  })

  // Delete mutation (une tournée)
  const deleteMutation = useMutation({
    mutationFn: async (driverName: string) => {
      const { data } = await api.delete(`/api/dispatcher/tour/${encodeURIComponent(driverName)}`, {
        params: { date: selectedDate }
      })
      return data
    },
    onSuccess: (data, driverName) => {
      qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
      qc.invalidateQueries({ queryKey: ['tours'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      alert(`✅ Tournée de ${driverName} supprimée (${data.memorizedColis || 0} colis mémorisés)`)
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err?.message || 'Erreur inconnue'
      alert(`Erreur: ${msg}`)
    },
  })

  // Reset ONLY DELETED tours mutation (restaurer supprimées)
  const resetDeletedMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/api/dispatcher/tours/reset-all', {
        date: selectedDate,
        onlyDeleted: true
      })
      return data
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
      qc.invalidateQueries({ queryKey: ['tours'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      alert(`✅ ${data.restoredTours || 0} tournée(s) supprimée(s) restaurée(s) (${data.restoredColis || 0} colis)`)
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err?.message || 'Erreur inconnue'
      alert(`Erreur: ${msg}`)
    },
  })

  // Upload optimized tour mutation
  const uploadMutation = useMutation({
    mutationFn: async ({ file, driverName }: { file: File; driverName: string }) => {
      return uploadOptimizedTour(file, selectedDate, driverName, user?.sousTraitantName || '')
    },
    onSuccess: (data, variables) => {
      qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
      qc.invalidateQueries({ queryKey: ['tours'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['colis'] })
      setUploadingDriver(null)
      alert(`✅ Tournée optimisée importée pour ${variables.driverName}: ${data.colisCount || 0} colis`)
    },
    onError: (err: any) => {
      setUploadingDriver(null)
      const msg = err?.response?.data?.message || err?.message || 'Erreur inconnue'
      alert(`Erreur d'import: ${msg}`)
    },
  })

  const handleFileUpload = (driverName: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingDriver(driverName)
    uploadMutation.mutate({ file, driverName })
    e.target.value = ''
  }

  // Handlers for import
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false) }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      f => f.name.endsWith('.pdf') || f.name.endsWith('.xlsx')
    )
    if (droppedFiles.length > 0) setFiles(prev => [...prev, ...droppedFiles])
  }
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files ? Array.from(e.target.files) : []
    if (selectedFiles.length > 0) {
      setFiles(prev => [...prev, ...selectedFiles.filter(f => f.name.endsWith('.pdf') || f.name.endsWith('.xlsx'))])
    }
  }
  const removeFile = (index: number) => setFiles(prev => prev.filter((_, i) => i !== index))

  const totalGofo = drivers.reduce((sum, d) => sum + d.gofoCount, 0)
  const totalCaniao = drivers.reduce((sum, d) => sum + d.caniaoCount, 0)
  const totalColis = drivers.reduce((sum, d) => sum + d.totalCount, 0)

  // Composant tableau réutilisable
  const DriversTable = ({ driversList, showGofo = true, showCaniao = true, canModify = true, forceStatus = null }: { driversList: MutualizedDriver[], showGofo?: boolean, showCaniao?: boolean, canModify?: boolean, forceStatus?: 'gofo' | 'cainiao' | null }) => (
    <table style={{ marginTop: 12 }}>
      <thead>
        <tr>
          <th>Chauffeur</th>
          {showGofo && <th>Gofo</th>}
          {showCaniao && <th>Cainiao</th>}
          <th>Total</th>
          <th>Statut</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {driversList.map((d) => {
          return (
            <tr key={d.name}>
              <td><strong>{d.name}</strong></td>
              {showGofo && (
                <td>
                  <span className="pill" style={{ background: '#2563eb' }}>{d.gofoCount}</span>
                </td>
              )}
              {showCaniao && (
                <td>
                  <span className="pill" style={{ background: '#7c3aed' }}>{d.caniaoCount}</span>
                </td>
              )}
              <td><strong>{forceStatus === 'gofo' ? d.gofoCount : forceStatus === 'cainiao' ? d.caniaoCount : d.totalCount}</strong></td>
              <td>
                {forceStatus === 'gofo' ? (
                  <span className="pill" style={{ background: '#3b82f6' }}>Gofo</span>
                ) : forceStatus === 'cainiao' ? (
                  <span className="pill" style={{ background: '#8b5cf6' }}>Cainiao</span>
                ) : d.isOptimized ? (
                  <span className="pill" style={{ background: '#22c55e' }}>✅ Optimisé</span>
                ) : d.isDispatcherImport ? (
                  <span className="pill" style={{ background: '#06b6d4' }}>📋 Ajouté</span>
                ) : d.hasBoth ? (
                  <span className="pill" style={{ background: '#f59e0b' }}>📦 Mutualisé</span>
                ) : d.gofoCount > 0 && d.caniaoCount > 0 ? (
                  <span className="pill" style={{ background: '#f59e0b' }}>📦 Mutualisé</span>
                ) : d.gofoCount > 0 ? (
                  <span className="pill" style={{ background: '#3b82f6' }}>Gofo</span>
                ) : (
                  <span className="pill" style={{ background: '#8b5cf6' }}>Cainiao</span>
                )}
              </td>
              <td>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button 
                    className="ghost-btn" 
                    onClick={() => downloadMutualizedExcel(d.name, selectedDate, forceStatus)} 
                    style={{ fontSize: 11, padding: '5px 10px', border: '1px solid #3b82f6', color: '#3b82f6', borderRadius: 6 }}
                    title="Télécharger Excel"
                  >
                    📥 Excel
                  </button>
                  {canModify && (
                    <>
                      <label 
                        className="btn" 
                        style={{ 
                          fontSize: 11, 
                          padding: '5px 10px', 
                          cursor: 'pointer', 
                          background: d.isOptimized ? '#22c55e' : '#f59e0b', 
                          opacity: uploadingDriver === d.name ? 0.6 : 1,
                          borderRadius: 6
                        }}
                        title={d.isOptimized ? 'Remplacer la tournée optimisée' : 'Importer fichier Spoke'}
                      >
                        {uploadingDriver === d.name ? '⏳...' : d.isOptimized ? '🔄 Remplacer' : '📤 Spoke'}
                        <input type="file" accept=".pdf,.xlsx,.xls" style={{ display: 'none' }} onChange={(e) => handleFileUpload(d.name, e)} disabled={uploadingDriver !== null} />
                      </label>
                      <button 
                        className="ghost-btn" 
                        onClick={() => {
                          if (window.confirm(`Supprimer la tournée de ${d.name} ? Les colis seront mémorisés pour le tri.`)) {
                            deleteMutation.mutate(d.name)
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        style={{ fontSize: 11, padding: '5px 8px', color: '#f87b7b' }}
                        title="Supprimer"
                      >
                        🗑️
                      </button>
                    </>
                  )}
                  {!canModify && (
                    <span className="muted" style={{ fontSize: 10 }}>🔒 Lecture seule</span>
                  )}
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  return (
    <div className="stack">
      <div className="surface">
        <h1 className="title">🚚 Mes Tournées</h1>
        <p className="muted">Gérez vos tournées et importez vos fichiers optimisés.</p>
        
        {/* Sélecteur de date unique pour toute la page */}
        <div className="input-group" style={{ marginTop: 16, maxWidth: 300 }}>
          <label htmlFor="date-filter" style={{ fontWeight: 600, color: '#4ade80' }}>📅 Date de travail</label>
          <input 
            id="date-filter" 
            type="date" 
            value={selectedDate} 
            onChange={(e) => setSelectedDate(e.target.value)} 
            style={{ fontSize: 16, padding: '10px 12px' }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid two">
        <div className="surface">
          <p className="card-title">📊 Chauffeurs</p>
          <p className="stat-value">{drivers.length}</p>
          <p className="stat-sub">tournée(s) à gérer</p>
        </div>
        <div className="surface">
          <p className="card-title">📦 Colis total</p>
          <p className="stat-value">{totalColis}</p>
          <p className="stat-sub">{totalGofo} Gofo + {totalCaniao} Cainiao</p>
        </div>
      </div>

      {/* Actions globales */}
      <div className="surface" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600 }}>Actions globales :</span>
        <button 
          className="btn" 
          onClick={() => {
            if (window.confirm(`Restaurer les tournées supprimées ?`)) {
              resetDeletedMutation.mutate()
            }
          }}
          disabled={resetDeletedMutation.isPending}
          style={{ background: '#22c55e' }}
        >
          {resetDeletedMutation.isPending ? '⏳...' : '♻️ Restaurer supprimées'}
        </button>
      </div>

      {/* Import Section avec vérification des doublons */}
      <div className="surface">
        <p className="card-title">📤 Importer des tournées</p>
        <p className="muted" style={{ marginBottom: 12 }}>Importez vos fichiers PDF Spoke ou Excel. Le nom du chauffeur sera extrait du nom de fichier.</p>
        <div className="input-group" style={{ marginTop: 12 }} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          <div
            style={{ border: isDragging ? '2px dashed var(--accent)' : '2px dashed #444', borderRadius: 8, padding: 24, textAlign: 'center', background: isDragging ? 'rgba(123, 97, 255, 0.1)' : 'transparent', cursor: 'pointer' }}
            onClick={() => document.getElementById('dispatcher-file')?.click()}
          >
            <p style={{ margin: 0, color: '#aaa' }}>
              {files.length === 0 ? '📂 Glissez vos fichiers PDF/Excel ici' : `${files.length} fichier(s) sélectionné(s)`}
            </p>
          </div>
          <input id="dispatcher-file" type="file" accept=".xlsx,.pdf" multiple onChange={handleFileInput} style={{ display: 'none' }} />
          {files.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {files.map((f, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--panel)', borderRadius: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 13 }}>📄 {f.name}</span>
                  <button className="ghost-btn" onClick={() => removeFile(i)} style={{ fontSize: 12, padding: '4px 8px', color: '#f87b7b' }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => importMutation.mutate()} disabled={importMutation.isPending || files.length === 0}>
            {importMutation.isPending ? 'Import...' : `Importer ${files.length || ''} fichier(s)`}
          </button>
        </div>
        <p className="muted" style={{ marginTop: 12, fontSize: 11 }}>
          ⚠️ Si des numéros de tracking existent déjà dans vos tournées, l'import sera annulé et vous serez averti.
        </p>
      </div>

      {isLoading && <div className="surface"><p className="muted">Chargement…</p></div>}
      {error && <div className="surface"><p className="muted" style={{ color: '#f87b7b' }}>Erreur: {(error as any)?.message}</p></div>}

      {!isLoading && !error && drivers.length === 0 && (
        <div className="surface">
          <p className="muted">Aucune tournée trouvée pour cette date.</p>
        </div>
      )}

      {/* Tournées Mutualisées / Optimisées / Ajoutées */}
      {mutualizedDrivers.length > 0 && (
        <div className="surface">
          <p className="card-title" style={{ color: '#4ade80' }}>✅ Tournées mutualisées / optimisées ({mutualizedDrivers.length})</p>
          <p className="muted">Gofo + Cainiao combinés ou tournées ajoutées - prêts pour Spoke</p>
          <DriversTable driversList={mutualizedDrivers} canModify={true} />
        </div>
      )}

      {/* Tournées Gofo - Lecture seule */}
      {gofoOnlyDrivers.length > 0 && (
        <div className="surface">
          <p className="card-title" style={{ color: '#3b82f6' }}>🔵 Tournées Gofo ({gofoOnlyDrivers.length})</p>
          <p className="muted">Tournées importées depuis Gofo (lecture seule)</p>
          <DriversTable driversList={gofoOnlyDrivers} showCaniao={false} canModify={false} forceStatus="gofo" />
        </div>
      )}

      {/* Tournées Cainiao - Lecture seule */}
      {caniaoOnlyDrivers.length > 0 && (
        <div className="surface">
          <p className="card-title" style={{ color: '#8b5cf6' }}>🟣 Tournées Cainiao ({caniaoOnlyDrivers.length})</p>
          <p className="muted">Tournées importées depuis Cainiao (lecture seule)</p>
          <DriversTable driversList={caniaoOnlyDrivers} showGofo={false} canModify={false} forceStatus="cainiao" />
        </div>
      )}

      {/* Instructions */}
      <div className="surface" style={{ background: 'rgba(245, 165, 36, 0.1)', borderColor: 'rgba(245, 165, 36, 0.3)' }}>
        <p className="card-title">💡 Comment faire</p>
        <ol style={{ margin: '12px 0', paddingLeft: 20, color: 'var(--muted)' }}>
          <li><strong>Téléchargez</strong> l'Excel avec le bouton 📥</li>
          <li><strong>Importez</strong> dans Spoke et optimisez</li>
          <li><strong>Exportez</strong> le PDF depuis Spoke</li>
          <li><strong>Réimportez</strong> ici avec 📤 Spoke (remplace automatiquement)</li>
        </ol>
      </div>
    </div>
  )
}

// =====================
// ADMIN VIEW
// =====================
function AdminView() {
  const qc = useQueryClient()
  const today = new Date().toISOString().split('T')[0]

  // Date unique pour toute la page
  const [selectedDate, setSelectedDate] = useState<string>(today)

  // Import state (sans dates séparées)
  const [files, setFiles] = useState<File[]>([])
  const [sousTraitant, setSousTraitant] = useState<string>('')
  const [isDragging, setIsDragging] = useState(false)
  const [caniaoFile, setCaniaoFile] = useState<File | null>(null)

  // Cainiao Excel uni-chauffeur state (sans date séparée)
  const [caniaoExcelFiles, setCaniaoExcelFiles] = useState<File[]>([])
  const [caniaoExcelSousTraitant, setCaniaoExcelSousTraitant] = useState<string>('')
  const [isCaniaoExcelDragging, setIsCaniaoExcelDragging] = useState(false)

  // Tours state (sans date séparée)
  const [toursSousTraitant, setToursSousTraitant] = useState<string>('TOUS')

  // Cainiao drag state
  const [isCaniaosDragging, setIsCaniaosDragging] = useState(false)

  // === NOUVEAU: État pour le modal d'association chauffeur inconnu (Gofo/Cainiao 1 fichier) ===
  const [unknownChauffeurModal, setUnknownChauffeurModal] = useState<{
    show: boolean
    chauffeur: string
    filename: string
    pendingFile: File | null
    sousTraitants: string[]
    existingChauffeurs: { name: string; sousTraitant: string; normalized: string }[]
    similarChauffeurs: { name: string; sousTraitant: string; normalized: string }[]
  }>({
    show: false,
    chauffeur: '',
    filename: '',
    pendingFile: null,
    sousTraitants: [],
    existingChauffeurs: [],
    similarChauffeurs: []
  })
  const [associationType, setAssociationType] = useState<'new' | 'existing'>('new')
  const [selectedAssociation, setSelectedAssociation] = useState<string>('')
  const [selectedExistingChauffeur, setSelectedExistingChauffeur] = useState<string>('')
  const [newSousTraitantName, setNewSousTraitantName] = useState<string>('')
  const [showCreateST, setShowCreateST] = useState(false)
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; results: any[] } | null>(null)

  // === État pour le modal MULTI-chauffeurs Cainiao PDF ===
  const [caniaoMultiModal, setCaniaoMultiModal] = useState<{
    show: boolean
    unknownChauffeurs: { chauffeur: string; plage: string; similarChauffeurs: any[] }[]
    sousTraitants: string[]
    existingChauffeurs: { name: string; sousTraitant: string; normalized: string }[]
    pendingFile: File | null
    filename: string
  }>({
    show: false,
    unknownChauffeurs: [],
    sousTraitants: [],
    existingChauffeurs: [],
    pendingFile: null,
    filename: ''
  })
  // Associations pour chaque chauffeur inconnu: { [chauffeurName]: { type: 'new'|'existing', sousTraitant: string, existingChauffeur?: string } }
  const [caniaoAssociations, setCaniaoAssociations] = useState<Record<string, { type: 'new' | 'existing'; sousTraitant: string; existingChauffeur?: string }>>({})
  const [caniaoNewST, setCaniaoNewST] = useState<string>('')

  // Sous-traitants
  const { data: sousTraitantsData, refetch: refetchSousTraitants } = useQuery({ queryKey: ['sous-traitants'], queryFn: getSousTraitants })
  const sousTraitants = sousTraitantsData?.sousTraitants || []

  // Mutualized drivers for admin
  const { data: mutualizedData } = useQuery({
    queryKey: ['mutualized-drivers', selectedDate],
    queryFn: () => getMutualizedDrivers(selectedDate),
    enabled: !!selectedDate,
  })
  const allDrivers: MutualizedDriver[] = mutualizedData?.drivers || []
  const mutualizedDrivers = allDrivers.filter(d => d.hasBoth || d.isOptimized || d.isDispatcherImport)
  // Gofo : TOUS ceux qui ont du Gofo (y compris optimisées)
  const gofoOnlyDrivers = allDrivers.filter(d => d.gofoCount > 0 && (!d.isDispatcherImport || d.isOptimized))
  // Cainiao : TOUS ceux qui ont du Cainiao (y compris optimisées)
  const caniaoOnlyDrivers = allDrivers.filter(d => d.caniaoCount > 0 && (!d.isDispatcherImport || d.isOptimized))

  // Import mutations
  const normalMutation = useMutation({
    mutationFn: async () => {
      if (files.length === 0) throw new Error('Aucun fichier sélectionné')
      if (!selectedDate) throw new Error('Date requise')
      
      const results: any[] = []
      const pendingFiles = [...files]
      
      setImportProgress({ current: 0, total: pendingFiles.length, results: [] })
      
      for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i]
        setImportProgress(prev => prev ? { ...prev, current: i + 1 } : null)
        
        try {
          // Envoyer avec ou sans sous-traitant (auto-dispatch côté backend)
          const result = await uploadTour(file, selectedDate, sousTraitant || '')
          results.push({ success: true, file: file.name, result })
        } catch (err: any) {
          const errorData = err?.response?.data
          
          // Chauffeur inconnu - besoin d'association
          if (errorData?.error === 'UNKNOWN_CHAUFFEUR') {
            // Stocker le fichier en attente et afficher le modal
            const remainingFiles = pendingFiles.slice(i)
            setFiles(remainingFiles)
            setImportProgress(null)
            setImportType('gofo')
            
            setUnknownChauffeurModal({
              show: true,
              chauffeur: errorData.chauffeur,
              filename: errorData.filename || file.name,
              pendingFile: file,
              sousTraitants: errorData.sousTraitants || sousTraitants,
              existingChauffeurs: errorData.existingChauffeurs || [],
              similarChauffeurs: errorData.similarChauffeurs || []
            })
            setSelectedAssociation('')
            setSelectedExistingChauffeur('')
            setAssociationType(errorData.similarChauffeurs?.length > 0 ? 'existing' : 'new')
            
            // Retourner les résultats partiels
            return { partial: true, results, remaining: remainingFiles.length }
          }
          
          // Autre erreur - ajouter aux résultats
          results.push({ 
            success: false, 
            file: file.name, 
            error: errorData?.message || err?.message || 'Erreur inconnue' 
          })
        }
      }
      
      return { partial: false, results, remaining: 0 }
    },
    onSuccess: (data) => {
      setImportProgress(null)
      
      if (data.partial) {
        // Import partiel - modal affiché
        const successCount = data.results.filter((r: any) => r.success).length
        if (successCount > 0) {
          qc.invalidateQueries({ queryKey: ['tours'] })
          qc.invalidateQueries({ queryKey: ['stats'] })
          qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
        }
        return
      }
      
      // Import complet
      setFiles([])
      setSousTraitant('')
      qc.invalidateQueries({ queryKey: ['tours'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
      
      const successResults = data.results.filter((r: any) => r.success)
      const failedResults = data.results.filter((r: any) => !r.success)
      const totalColis = successResults.reduce((sum: number, r: any) => sum + (r.result?.tour?.colisCount || r.result?.colisCount || 0), 0)
      const totalDuplicates = successResults.reduce((sum: number, r: any) => 
        sum + (r.result?.duplicatesIgnored || 0) + (r.result?.duplicatesInFileIgnored || 0), 0
      )
      
      let message = `${successResults.length} tournée(s) importée(s): ${totalColis} colis`
      if (totalDuplicates > 0) {
        message += ` (${totalDuplicates} doublons ignorés)`
      }
      if (failedResults.length > 0) {
        message += `\n\n⚠️ ${failedResults.length} erreur(s):\n` + 
          failedResults.map((r: any) => `• ${r.file}: ${r.error}`).join('\n')
      }
      alert(message)
    },
    onError: (err: any) => {
      setImportProgress(null)
      alert(`Erreur: ${err?.response?.data?.message || err?.message}`)
    },
  })

  // Fonction pour associer un chauffeur et réessayer l'import
  const handleAssociateChauffeur = async () => {
    let finalST = ''
    
    if (associationType === 'existing') {
      // Lier à un chauffeur existant
      if (!selectedExistingChauffeur) {
        alert('Veuillez sélectionner un chauffeur existant')
        return
      }
      
      // Trouver le sous-traitant du chauffeur sélectionné
      const existingChauffeur = unknownChauffeurModal.existingChauffeurs.find(
        c => c.name === selectedExistingChauffeur
      )
      if (!existingChauffeur) {
        alert('Chauffeur non trouvé')
        return
      }
      
      finalST = existingChauffeur.sousTraitant
      
      // Créer l'association pour ce nouveau nom (alias)
      try {
        await api.post('/api/chauffeurs', {
          name: unknownChauffeurModal.chauffeur,
          sousTraitant: finalST
        })
      } catch (err: any) {
        if (err?.response?.data?.error !== 'ALREADY_EXISTS') {
          alert(`Erreur association: ${err?.response?.data?.message || err?.message}`)
          return
        }
      }
      
    } else {
      // Nouveau chauffeur
      if (!selectedAssociation && !newSousTraitantName.trim()) {
        alert('Veuillez sélectionner ou créer un sous-traitant')
        return
      }
      
      finalST = selectedAssociation
      
      // Créer le nouveau sous-traitant si nécessaire
      if (showCreateST && newSousTraitantName.trim()) {
        try {
          await api.post('/api/sous-traitants', { name: newSousTraitantName.trim() })
          finalST = newSousTraitantName.trim()
          await refetchSousTraitants()
        } catch (err: any) {
          alert(`Erreur création sous-traitant: ${err?.response?.data?.message || err?.message}`)
          return
        }
      }
      
      // Créer l'association chauffeur → sous-traitant
      try {
        await api.post('/api/chauffeurs', {
          name: unknownChauffeurModal.chauffeur,
          sousTraitant: finalST
        })
      } catch (err: any) {
        if (err?.response?.data?.error !== 'ALREADY_EXISTS') {
          alert(`Erreur association: ${err?.response?.data?.message || err?.message}`)
          return
        }
      }
    }
    
    // Fermer le modal et réinitialiser
    setUnknownChauffeurModal({ 
      show: false, chauffeur: '', filename: '', pendingFile: null, 
      sousTraitants: [], existingChauffeurs: [], similarChauffeurs: [] 
    })
    setShowCreateST(false)
    setNewSousTraitantName('')
    setSelectedAssociation('')
    setSelectedExistingChauffeur('')
    setAssociationType('new')
    
    // Relancer l'import avec le fichier en attente
    if (unknownChauffeurModal.pendingFile) {
      try {
        if (importType === 'cainiao') {
          // Import Cainiao
          const formData = new FormData()
          formData.append('file', unknownChauffeurModal.pendingFile)
          formData.append('date', selectedDate)
          formData.append('sousTraitantName', finalST)
          await api.post('/api/tours/import/caniao-excel', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
          // Retirer le fichier de la liste et continuer
          setCaniaoExcelFiles(prev => prev.slice(1))
          qc.invalidateQueries({ queryKey: ['tours'] })
          qc.invalidateQueries({ queryKey: ['stats'] })
          qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
          
          // S'il reste des fichiers, relancer l'import
          if (caniaoExcelFiles.length > 1) {
            setTimeout(() => caniaoExcelMutation.mutate(), 100)
          } else {
            setCaniaoExcelFiles([])
            const linkedMsg = associationType === 'existing' 
              ? ` (lié à ${selectedExistingChauffeur})`
              : ''
            alert(`✅ Tournée Cainiao importée pour ${unknownChauffeurModal.chauffeur}${linkedMsg} → ${finalST}`)
          }
        } else {
          // Import Gofo
          await uploadTour(unknownChauffeurModal.pendingFile, selectedDate, finalST)
          // Retirer le fichier de la liste et continuer
          setFiles(prev => prev.slice(1))
          qc.invalidateQueries({ queryKey: ['tours'] })
          qc.invalidateQueries({ queryKey: ['stats'] })
          qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
          
          // S'il reste des fichiers, relancer l'import
          if (files.length > 1) {
            setTimeout(() => normalMutation.mutate(), 100)
          } else {
            setFiles([])
            const linkedMsg = associationType === 'existing' 
              ? ` (lié à ${selectedExistingChauffeur})`
              : ''
            alert(`✅ Tournée importée pour ${unknownChauffeurModal.chauffeur}${linkedMsg} → ${finalST}`)
          }
        }
      } catch (err: any) {
        alert(`Erreur import: ${err?.response?.data?.message || err?.message}`)
      }
    }
  }

  // Fonction pour associer plusieurs chauffeurs (import Cainiao PDF multi)
  const handleCaniaoMultiAssociation = async () => {
    // Vérifier que tous les chauffeurs ont une association
    for (const unknown of caniaoMultiModal.unknownChauffeurs) {
      const assoc = caniaoAssociations[unknown.chauffeur]
      if (!assoc) {
        alert(`Veuillez configurer l'association pour ${unknown.chauffeur}`)
        return
      }
      if (assoc.type === 'new' && !assoc.sousTraitant) {
        alert(`Veuillez sélectionner un sous-traitant pour ${unknown.chauffeur}`)
        return
      }
      if (assoc.type === 'existing' && !assoc.existingChauffeur) {
        alert(`Veuillez sélectionner un chauffeur existant pour ${unknown.chauffeur}`)
        return
      }
    }
    
    // Créer d'abord le nouveau sous-traitant si nécessaire
    if (caniaoNewST.trim()) {
      try {
        await api.post('/api/sous-traitants', { name: caniaoNewST.trim() })
        await refetchSousTraitants()
      } catch (err: any) {
        if (err?.response?.data?.error !== 'ALREADY_EXISTS') {
          alert(`Erreur création sous-traitant: ${err?.response?.data?.message || err?.message}`)
          return
        }
      }
    }
    
    // Créer les associations pour chaque chauffeur
    for (const unknown of caniaoMultiModal.unknownChauffeurs) {
      const assoc = caniaoAssociations[unknown.chauffeur]
      
      let finalST = ''
      if (assoc.type === 'existing') {
        // Trouver le sous-traitant du chauffeur existant
        const existingChauffeur = caniaoMultiModal.existingChauffeurs.find(c => c.name === assoc.existingChauffeur)
        if (existingChauffeur) {
          finalST = existingChauffeur.sousTraitant
        }
      } else {
        finalST = assoc.sousTraitant || caniaoNewST.trim()
      }
      
      if (!finalST) {
        alert(`Sous-traitant manquant pour ${unknown.chauffeur}`)
        return
      }
      
      // Créer l'association chauffeur → sous-traitant
      try {
        await api.post('/api/chauffeurs', {
          name: unknown.chauffeur,
          sousTraitant: finalST
        })
      } catch (err: any) {
        if (err?.response?.data?.error !== 'ALREADY_EXISTS') {
          alert(`Erreur association ${unknown.chauffeur}: ${err?.response?.data?.message || err?.message}`)
          return
        }
      }
    }
    
    // Fermer le modal
    setCaniaoMultiModal({
      show: false,
      unknownChauffeurs: [],
      sousTraitants: [],
      existingChauffeurs: [],
      pendingFile: null,
      filename: ''
    })
    setCaniaoAssociations({})
    setCaniaoNewST('')
    
    // Relancer l'import
    if (caniaoMultiModal.pendingFile) {
      try {
        const data = await uploadTourCaniao(caniaoMultiModal.pendingFile, selectedDate)
        setCaniaoFile(null)
        qc.invalidateQueries({ queryKey: ['tours'] })
        qc.invalidateQueries({ queryKey: ['stats'] })
        qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
        
        const toursCount = data.tours?.length || 0
        const totalColis = data.totalColisImported || data.tours?.reduce((sum: number, t: any) => sum + (t.colisCount || 0), 0) || 0
        alert(`✅ Import CANIAO réussi: ${toursCount} tournée(s), ${totalColis} colis`)
      } catch (err: any) {
        alert(`Erreur import: ${err?.response?.data?.message || err?.message}`)
      }
    }
  }

  const caniaoMutation = useMutation({
    mutationFn: () => {
      if (!caniaoFile) throw new Error('Aucun fichier CANIAO')
      if (!selectedDate) throw new Error('Date requise')
      return uploadTourCaniao(caniaoFile, selectedDate)
    },
    onSuccess: (data) => {
      setCaniaoFile(null)
      qc.invalidateQueries({ queryKey: ['tours'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
      
      const toursCount = data.tours?.length || 0
      const totalColis = data.totalColisImported || data.tours?.reduce((sum: number, t: any) => sum + (t.colisCount || 0), 0) || 0
      const totalDuplicates = data.totalDuplicatesIgnored || 0
      
      let message = `Import CANIAO réussi: ${toursCount} tournée(s), ${totalColis} colis`
      if (totalDuplicates > 0) {
        message += ` (${totalDuplicates} doublons ignorés)`
      }
      alert(message)
    },
    onError: (err: any) => {
      const errorData = err?.response?.data
      
      // Gérer l'erreur UNKNOWN_CHAUFFEURS (multi-chauffeurs)
      if (errorData?.error === 'UNKNOWN_CHAUFFEURS') {
        setCaniaoMultiModal({
          show: true,
          unknownChauffeurs: errorData.unknownChauffeurs || [],
          sousTraitants: errorData.sousTraitants || sousTraitants,
          existingChauffeurs: errorData.existingChauffeurs || [],
          pendingFile: caniaoFile,
          filename: errorData.filename || caniaoFile?.name || ''
        })
        // Initialiser les associations vides
        const initialAssociations: Record<string, { type: 'new' | 'existing'; sousTraitant: string; existingChauffeur?: string }> = {}
        for (const unknown of errorData.unknownChauffeurs || []) {
          initialAssociations[unknown.chauffeur] = { type: 'new', sousTraitant: '' }
        }
        setCaniaoAssociations(initialAssociations)
        return
      }
      
      alert(`Erreur CANIAO: ${errorData?.message || err?.message}`)
    },
  })

  // État pour savoir quel type d'import est en cours (pour le modal)
  const [importType, setImportType] = useState<'gofo' | 'cainiao'>('gofo')

  // Cainiao Excel/PDF uni-chauffeur mutation - AVEC AUTO-DISPATCH
  const caniaoExcelMutation = useMutation({
    mutationFn: async () => {
      if (caniaoExcelFiles.length === 0) throw new Error('Aucun fichier sélectionné')
      if (!selectedDate) throw new Error('Date requise')
      
      const results: any[] = []
      const pendingFiles = [...caniaoExcelFiles]
      
      for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i]
        
        try {
          const formData = new FormData()
          formData.append('file', file)
          formData.append('date', selectedDate)
          // Envoyer avec ou sans sous-traitant (auto-dispatch côté backend)
          if (caniaoExcelSousTraitant) {
            formData.append('sousTraitantName', caniaoExcelSousTraitant)
          }
          const { data } = await api.post('/api/tours/import/caniao-excel', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
          results.push({ success: true, file: file.name, result: data })
        } catch (err: any) {
          const errorData = err?.response?.data
          
          // Chauffeur inconnu - besoin d'association
          if (errorData?.error === 'UNKNOWN_CHAUFFEUR') {
            // Stocker le fichier en attente et afficher le modal
            const remainingFiles = pendingFiles.slice(i)
            setCaniaoExcelFiles(remainingFiles)
            setImportType('cainiao')
            
            setUnknownChauffeurModal({
              show: true,
              chauffeur: errorData.chauffeur,
              filename: errorData.filename || file.name,
              pendingFile: file,
              sousTraitants: errorData.sousTraitants || sousTraitants,
              existingChauffeurs: errorData.existingChauffeurs || [],
              similarChauffeurs: errorData.similarChauffeurs || []
            })
            setSelectedAssociation('')
            setSelectedExistingChauffeur('')
            setAssociationType(errorData.similarChauffeurs?.length > 0 ? 'existing' : 'new')
            
            // Retourner les résultats partiels
            return { partial: true, results, remaining: remainingFiles.length }
          }
          
          // Autre erreur
          results.push({ 
            success: false, 
            file: file.name, 
            error: errorData?.message || err?.message || 'Erreur inconnue' 
          })
        }
      }
      
      return { partial: false, results, remaining: 0 }
    },
    onSuccess: (data) => {
      if (data.partial) {
        // Import partiel - modal affiché
        const successCount = data.results.filter((r: any) => r.success).length
        if (successCount > 0) {
          qc.invalidateQueries({ queryKey: ['tours'] })
          qc.invalidateQueries({ queryKey: ['stats'] })
          qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
        }
        return
      }
      
      // Import complet
      setCaniaoExcelFiles([])
      setCaniaoExcelSousTraitant('')
      qc.invalidateQueries({ queryKey: ['tours'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
      
      const successResults = data.results.filter((r: any) => r.success)
      const failedResults = data.results.filter((r: any) => !r.success)
      const totalColis = successResults.reduce((sum: number, r: any) => sum + (r.result?.tour?.colisCount || r.result?.colisCount || 0), 0)
      const totalDuplicates = successResults.reduce((sum: number, r: any) => 
        sum + (r.result?.duplicatesIgnored || 0) + (r.result?.duplicatesInFileIgnored || 0), 0
      )
      
      let message = `${successResults.length} tournée(s) Cainiao importée(s): ${totalColis} colis`
      if (totalDuplicates > 0) {
        message += ` (${totalDuplicates} doublons ignorés)`
      }
      if (failedResults.length > 0) {
        message += `\n\n⚠️ ${failedResults.length} erreur(s):\n` + 
          failedResults.map((r: any) => `• ${r.file}: ${r.error}`).join('\n')
      }
      alert(message)
    },
    onError: (err: any) => {
      alert(`Erreur Cainiao: ${err?.response?.data?.message || err?.message}`)
    },
  })

  // Tours queries
  const { data: normalData, isLoading: normalLoading } = useQuery({
    queryKey: ['tours', 'normal', selectedDate, toursSousTraitant],
    queryFn: () => getTours({ date: selectedDate || undefined, sousTraitant: toursSousTraitant !== 'TOUS' ? toursSousTraitant : undefined, isCaniaoOnly: false }),
  })
  const { data: caniaoData, isLoading: caniaoLoading } = useQuery({
    queryKey: ['tours', 'caniao', selectedDate],
    queryFn: () => getTours({ date: selectedDate || undefined, isCaniaoOnly: true }),
  })
  const normalTours = normalData?.tours || []
  const caniaoTours = caniaoData?.tours || []

  const deleteMutation = useMutation({
    mutationFn: (tourId: number) => deleteTour(tourId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tours'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
    },
  })

  const deleteAllNormalTours = async () => {
    if (!window.confirm(`Supprimer ${normalTours.length} tournées Gofo?`)) return
    for (const tour of normalTours) { try { await deleteTour(tour.id) } catch {} }
    qc.invalidateQueries({ queryKey: ['tours'] })
    qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
  }

  const deleteAllCaniaoTours = async () => {
    if (!window.confirm(`Supprimer ${caniaoTours.length} tournées Cainiao?`)) return
    for (const tour of caniaoTours) { try { await deleteTour(tour.id) } catch {} }
    qc.invalidateQueries({ queryKey: ['tours'] })
    qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
  }

  // Handlers - Plus besoin d'exiger le sous-traitant (auto-dispatch)
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false) }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false)
    const droppedFiles = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.pdf') || f.name.endsWith('.xlsx'))
    if (droppedFiles.length > 0) setFiles(prev => [...prev, ...droppedFiles])
  }
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files ? Array.from(e.target.files) : []
    setFiles(prev => [...prev, ...selectedFiles.filter(f => f.name.endsWith('.pdf') || f.name.endsWith('.xlsx'))])
  }
  const removeFile = (index: number) => setFiles(prev => prev.filter((_, i) => i !== index))

  // Handlers Cainiao Excel/PDF - Plus besoin d'exiger le sous-traitant (auto-dispatch)
  const handleCaniaoExcelDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsCaniaoExcelDragging(true) }
  const handleCaniaoExcelDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsCaniaoExcelDragging(false) }
  const handleCaniaoExcelDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsCaniaoExcelDragging(false)
    const droppedFiles = Array.from(e.dataTransfer.files).filter(f => 
      f.name.endsWith('.xlsx') || f.name.endsWith('.pdf')
    )
    if (droppedFiles.length > 0) setCaniaoExcelFiles(prev => [...prev, ...droppedFiles])
  }
  const handleCaniaoExcelFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files ? Array.from(e.target.files) : []
    setCaniaoExcelFiles(prev => [...prev, ...selectedFiles.filter(f => 
      f.name.endsWith('.xlsx') || f.name.endsWith('.pdf')
    )])
  }
  const removeCaniaoExcelFile = (index: number) => setCaniaoExcelFiles(prev => prev.filter((_, i) => i !== index))

  // Table component for mutualized view
  const MutualizedTable = ({ driversList, title, color, forceStatus = null }: { driversList: MutualizedDriver[], title: string, color: string, forceStatus?: 'gofo' | 'cainiao' | null }) => (
    <div className="surface">
      <p className="card-title" style={{ color }}>{title} ({driversList.length})</p>
      <table style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Chauffeur</th>
            <th>S-T</th>
            {(!forceStatus || forceStatus !== 'cainiao') && <th>Gofo</th>}
            {(!forceStatus || forceStatus !== 'gofo') && <th>Cainiao</th>}
            <th>Total</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {driversList.map((d) => (
            <tr key={d.name}>
              <td><strong>{d.name}</strong></td>
              <td>{d.sousTraitant || '-'}</td>
              {(!forceStatus || forceStatus !== 'cainiao') && <td><span className="pill" style={{ background: '#2563eb' }}>{d.gofoCount}</span></td>}
              {(!forceStatus || forceStatus !== 'gofo') && <td><span className="pill" style={{ background: '#7c3aed' }}>{d.caniaoCount}</span></td>}
              <td><strong>{forceStatus === 'gofo' ? d.gofoCount : forceStatus === 'cainiao' ? d.caniaoCount : d.totalCount}</strong></td>
              <td>
                <button className="btn" onClick={() => downloadMutualizedExcel(d.name, selectedDate, forceStatus)} style={{ fontSize: 12, padding: '6px 10px' }}>
                  📥 Excel
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div>
      <div className="surface">
        <h1 className="title">📦 Import & Tournées</h1>
        <p className="muted">Importez les fichiers Gofo et Cainiao, gérez les tournées.</p>
        
        {/* Sélecteur de date unique pour toute la page */}
        <div className="input-group" style={{ marginTop: 16, maxWidth: 300 }}>
          <label htmlFor="global-date" style={{ fontWeight: 600, color: '#4ade80' }}>📅 Date de travail</label>
          <input 
            id="global-date" 
            type="date" 
            value={selectedDate} 
            onChange={(e) => setSelectedDate(e.target.value)} 
            style={{ fontSize: 16, padding: '10px 12px' }}
          />
        </div>
      </div>

      <div className="toursimport-flex">
        {/* Colonne Import */}
        <div className="toursimport-col">
          {/* Import Gofo */}
          <div className="surface">
            <p className="card-title">🔵 Import Gofo (Excel)</p>
            <div className="input-group">
              <label>Sous-traitant (optionnel - auto-dispatch)</label>
              <select value={sousTraitant} onChange={(e) => setSousTraitant(e.target.value)}>
                <option value="">-- Auto-dispatch --</option>
                {sousTraitants.map(st => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>
            <div className="input-group" style={{ marginTop: 12 }} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
              <div style={{ border: isDragging ? '2px dashed var(--accent)' : '2px dashed #444', borderRadius: 8, padding: 24, textAlign: 'center', cursor: 'pointer' }}
                   onClick={() => document.getElementById('normal-file')?.click()}>
                <p style={{ margin: 0, color: '#aaa' }}>{files.length === 0 ? '📂 Glissez vos fichiers PDF/Excel ici (auto-dispatch activé)' : `${files.length} fichier(s)`}</p>
              </div>
              <input id="normal-file" type="file" accept=".xlsx,.pdf" multiple onChange={handleFileInput} style={{ display: 'none' }} />
              {files.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  {files.map((f, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--panel)', borderRadius: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 13 }}>📄 {f.name}</span>
                      <button className="ghost-btn" onClick={() => removeFile(i)} style={{ color: '#f87b7b' }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
              💡 Les chauffeurs connus seront automatiquement dispatchés. Les nouveaux chauffeurs demanderont une association.
            </p>
            <button className="btn" style={{ marginTop: 12 }} onClick={() => normalMutation.mutate()} disabled={normalMutation.isPending || files.length === 0}>
              {normalMutation.isPending ? 'Import...' : `Importer ${files.length || ''} fichier(s)`}
            </button>
          </div>

          {/* Import Cainiao */}
          <div className="surface">
            <p className="card-title">🟣 Import Cainiao (PDF)</p>
            <div 
              className="input-group" 
              onDragOver={(e) => { e.preventDefault(); setIsCaniaosDragging(true) }}
              onDragLeave={(e) => { e.preventDefault(); setIsCaniaosDragging(false) }}
              onDrop={(e) => {
                e.preventDefault()
                setIsCaniaosDragging(false)
                const droppedFile = Array.from(e.dataTransfer.files).find(f => f.name.endsWith('.pdf'))
                if (droppedFile) setCaniaoFile(droppedFile)
              }}
            >
              <div 
                style={{ 
                  border: isCaniaosDragging ? '2px dashed #7c3aed' : '2px dashed #444', 
                  borderRadius: 8, 
                  padding: 24, 
                  textAlign: 'center', 
                  cursor: 'pointer',
                  background: isCaniaosDragging ? 'rgba(124, 58, 237, 0.1)' : 'transparent'
                }}
                onClick={() => document.getElementById('caniao-file')?.click()}
              >
                <p style={{ margin: 0, color: '#aaa' }}>
                  {caniaoFile ? `📄 ${caniaoFile.name}` : '📂 Glissez votre fichier PDF Cainiao ici'}
                </p>
              </div>
              <input 
                id="caniao-file" 
                type="file" 
                accept=".pdf" 
                onChange={(e) => setCaniaoFile(e.target.files?.[0] || null)} 
                style={{ display: 'none' }} 
              />
              {caniaoFile && (
                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--panel)', borderRadius: 6 }}>
                  <span style={{ fontSize: 13 }}>📄 {caniaoFile.name}</span>
                  <button className="ghost-btn" onClick={() => setCaniaoFile(null)} style={{ color: '#f87b7b' }}>✕</button>
                </div>
              )}
            </div>
            <button className="btn" style={{ marginTop: 12 }} onClick={() => caniaoMutation.mutate()} disabled={caniaoMutation.isPending || !caniaoFile}>
              {caniaoMutation.isPending ? 'Import...' : 'Importer Cainiao'}
            </button>
          </div>

          {/* Import Cainiao Excel/PDF uni-chauffeur - AVEC AUTO-DISPATCH */}
          <div className="surface">
            <p className="card-title">🟣 Import Cainiao (1 chauffeur/fichier)</p>
            <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>Fichiers Excel ou PDF Cainiao - auto-dispatch activé</p>
            <div className="input-group">
              <label>Sous-traitant (optionnel - auto-dispatch)</label>
              <select value={caniaoExcelSousTraitant} onChange={(e) => setCaniaoExcelSousTraitant(e.target.value)}>
                <option value="">-- Auto-dispatch --</option>
                {sousTraitants.map(st => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>
            <div 
              className="input-group" 
              style={{ marginTop: 12 }}
              onDragOver={handleCaniaoExcelDragOver}
              onDragLeave={handleCaniaoExcelDragLeave}
              onDrop={handleCaniaoExcelDrop}
            >
              <div 
                style={{ 
                  border: isCaniaoExcelDragging ? '2px dashed #7c3aed' : '2px dashed #444', 
                  borderRadius: 8, 
                  padding: 24, 
                  textAlign: 'center', 
                  cursor: 'pointer',
                  background: isCaniaoExcelDragging ? 'rgba(124, 58, 237, 0.1)' : 'transparent'
                }}
                onClick={() => document.getElementById('caniao-excel-file')?.click()}
              >
                <p style={{ margin: 0, color: '#aaa' }}>
                  {caniaoExcelFiles.length === 0 ? '📂 Glissez vos fichiers Excel/PDF Cainiao ici' : `${caniaoExcelFiles.length} fichier(s)`}
                </p>
              </div>
              <input 
                id="caniao-excel-file" 
                type="file" 
                accept=".xlsx,.pdf" 
                multiple
                onChange={handleCaniaoExcelFileInput} 
                style={{ display: 'none' }} 
              />
              {caniaoExcelFiles.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  {caniaoExcelFiles.map((f, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--panel)', borderRadius: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 13 }}>📄 {f.name}</span>
                      <button className="ghost-btn" onClick={() => removeCaniaoExcelFile(i)} style={{ color: '#f87b7b' }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
              💡 Les chauffeurs connus seront automatiquement dispatchés. Les nouveaux chauffeurs demanderont une association.
            </p>
            <button className="btn" style={{ marginTop: 12 }} onClick={() => caniaoExcelMutation.mutate()} disabled={caniaoExcelMutation.isPending || caniaoExcelFiles.length === 0}>
              {caniaoExcelMutation.isPending ? 'Import...' : `Importer ${caniaoExcelFiles.length || ''} fichier(s) Cainiao`}
            </button>
          </div>
        </div>

        {/* Colonne Tournées */}
        <div className="toursimport-col">
          {/* Filtres */}
          <div className="surface">
            <p className="card-title">🔍 Filtre sous-traitant</p>
            <div className="input-group">
              <label>Sous-traitant</label>
              <select value={toursSousTraitant} onChange={(e) => setToursSousTraitant(e.target.value)}>
                <option value="TOUS">TOUS</option>
                {sousTraitants.map(st => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>
          </div>

          {/* Tournées Gofo */}
          <div className="surface">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p className="card-title" style={{ margin: 0 }}>🔵 Gofo ({normalTours.length})</p>
              {normalTours.length > 0 && <button className="ghost-btn" onClick={deleteAllNormalTours} style={{ color: '#f87b7b', fontSize: 13 }}>🗑️ Tout supprimer</button>}
            </div>
            {normalLoading && <p className="muted">Chargement…</p>}
            {!normalLoading && normalTours.length === 0 && <p className="muted">Aucune tournée Gofo.</p>}
            {normalTours.length > 0 && (
              <table style={{ marginTop: 12 }}>
                <thead><tr><th>Chauffeur</th><th>S-T</th><th>Colis</th><th></th></tr></thead>
                <tbody>
                  {normalTours.map((t) => (
                    <tr key={t.id}>
                      <td>{t.chauffeurName}</td>
                      <td>{t.sousTraitantName || '-'}</td>
                      <td>{t.colisCount}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn" onClick={() => downloadTour(t.id)} style={{ fontSize: 11, padding: '4px 8px' }}>📥</button>
                          <button className="ghost-btn" onClick={() => { if (window.confirm(`Supprimer ${t.chauffeurName}?`)) deleteMutation.mutate(t.id) }} style={{ fontSize: 11, padding: '4px 8px' }}>🗑️</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Tournées Cainiao */}
          <div className="surface">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p className="card-title" style={{ margin: 0 }}>🟣 Cainiao ({caniaoTours.length})</p>
              {caniaoTours.length > 0 && <button className="ghost-btn" onClick={deleteAllCaniaoTours} style={{ color: '#f87b7b', fontSize: 13 }}>🗑️ Tout supprimer</button>}
            </div>
            {caniaoLoading && <p className="muted">Chargement…</p>}
            {!caniaoLoading && caniaoTours.length === 0 && <p className="muted">Aucune tournée Cainiao.</p>}
            {caniaoTours.length > 0 && (
              <table style={{ marginTop: 12 }}>
                <thead><tr><th>Chauffeur</th><th>Colis</th><th></th></tr></thead>
                <tbody>
                  {caniaoTours.map((t) => (
                    <tr key={t.id}>
                      <td>{t.chauffeurName}</td>
                      <td>{t.colisCount}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn" onClick={() => downloadTour(t.id)} style={{ fontSize: 11, padding: '4px 8px' }}>📥</button>
                          <button className="ghost-btn" onClick={() => { if (window.confirm(`Supprimer ${t.chauffeurName}?`)) deleteMutation.mutate(t.id) }} style={{ fontSize: 11, padding: '4px 8px' }}>🗑️</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Section Mutualisation pour Admin */}
      <div className="stack" style={{ marginTop: 24 }}>
        <div className="surface">
          <h2 className="title">📦 Vue Mutualisation</h2>
          <p className="muted">Téléchargez les fichiers Excel mutualisés pour chaque chauffeur.</p>
        </div>

        {mutualizedDrivers.length > 0 && (
          <MutualizedTable driversList={mutualizedDrivers} title="✅ Mutualisés (Gofo + Cainiao)" color="#4ade80" />
        )}
        {gofoOnlyDrivers.length > 0 && (
          <MutualizedTable driversList={gofoOnlyDrivers} title="🔵 Gofo uniquement" color="#3b82f6" forceStatus="gofo" />
        )}
        {caniaoOnlyDrivers.length > 0 && (
          <MutualizedTable driversList={caniaoOnlyDrivers} title="🟣 Cainiao uniquement" color="#8b5cf6" forceStatus="cainiao" />
        )}
      </div>

      {/* === MODAL: Association chauffeur inconnu === */}
      {unknownChauffeurModal.show && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'var(--surface)',
            borderRadius: 12,
            padding: 24,
            maxWidth: 550,
            width: '90%',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)'
          }}>
            <h3 style={{ margin: '0 0 8px 0', color: '#f59e0b' }}>⚠️ Chauffeur non reconnu</h3>
            <p style={{ margin: '0 0 8px 0', color: '#aaa' }}>
              Le chauffeur <strong style={{ color: '#fff', fontSize: 16 }}>"{unknownChauffeurModal.chauffeur}"</strong> n'est pas encore enregistré.
            </p>
            <p style={{ margin: '0 0 16px 0', fontSize: 12, color: '#666' }}>
              Fichier: {unknownChauffeurModal.filename}
            </p>

            {/* Choix du type d'association */}
            <div style={{ 
              display: 'flex', 
              gap: 8, 
              marginBottom: 16,
              background: 'var(--panel)',
              borderRadius: 8,
              padding: 4
            }}>
              <button
                onClick={() => setAssociationType('existing')}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: associationType === 'existing' ? 'var(--accent)' : 'transparent',
                  color: associationType === 'existing' ? '#fff' : '#aaa',
                  fontWeight: associationType === 'existing' ? 'bold' : 'normal',
                  transition: 'all 0.2s'
                }}
              >
                🔗 Chauffeur existant
              </button>
              <button
                onClick={() => setAssociationType('new')}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: associationType === 'new' ? 'var(--accent)' : 'transparent',
                  color: associationType === 'new' ? '#fff' : '#aaa',
                  fontWeight: associationType === 'new' ? 'bold' : 'normal',
                  transition: 'all 0.2s'
                }}
              >
                ➕ Nouveau chauffeur
              </button>
            </div>

            {/* Option 1: Lier à un chauffeur existant */}
            {associationType === 'existing' && (
              <div>
                <p style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>
                  C'est peut-être le même chauffeur avec un nom écrit différemment ?
                </p>
                
                {/* Suggestions de chauffeurs similaires */}
                {unknownChauffeurModal.similarChauffeurs.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 8 }}>💡 Chauffeurs similaires détectés :</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {unknownChauffeurModal.similarChauffeurs.map(c => (
                        <button
                          key={c.name}
                          onClick={() => setSelectedExistingChauffeur(c.name)}
                          style={{
                            padding: '8px 12px',
                            border: selectedExistingChauffeur === c.name ? '2px solid var(--accent)' : '1px solid #444',
                            borderRadius: 6,
                            background: selectedExistingChauffeur === c.name ? 'rgba(124, 58, 237, 0.2)' : 'var(--panel)',
                            color: '#fff',
                            cursor: 'pointer'
                          }}
                        >
                          <strong>{c.name}</strong>
                          <span style={{ fontSize: 11, color: '#888', marginLeft: 6 }}>({c.sousTraitant})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="input-group">
                  <label>Ou sélectionner dans la liste complète</label>
                  <select 
                    value={selectedExistingChauffeur} 
                    onChange={(e) => setSelectedExistingChauffeur(e.target.value)}
                    style={{ width: '100%' }}
                  >
                    <option value="">-- Choisir un chauffeur existant --</option>
                    {unknownChauffeurModal.existingChauffeurs.map(c => (
                      <option key={c.name} value={c.name}>
                        {c.name} ({c.sousTraitant})
                      </option>
                    ))}
                  </select>
                </div>

                {selectedExistingChauffeur && (
                  <p style={{ fontSize: 13, color: '#4ade80', marginTop: 12 }}>
                    ✓ "{unknownChauffeurModal.chauffeur}" sera enregistré comme alias de "{selectedExistingChauffeur}"
                  </p>
                )}

                {unknownChauffeurModal.existingChauffeurs.length === 0 && (
                  <p style={{ fontSize: 13, color: '#888', marginTop: 12 }}>
                    Aucun chauffeur enregistré. Utilisez l'option "Nouveau chauffeur".
                  </p>
                )}
              </div>
            )}

            {/* Option 2: Nouveau chauffeur */}
            {associationType === 'new' && (
              <div>
                <p style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>
                  Créer un nouveau chauffeur et l'associer à un sous-traitant.
                </p>

                {!showCreateST ? (
                  <>
                    <div className="input-group">
                      <label>Associer au sous-traitant</label>
                      <select 
                        value={selectedAssociation} 
                        onChange={(e) => setSelectedAssociation(e.target.value)}
                        style={{ width: '100%' }}
                      >
                        <option value="">-- Choisir un sous-traitant --</option>
                        {(unknownChauffeurModal.sousTraitants.length > 0 
                          ? unknownChauffeurModal.sousTraitants 
                          : sousTraitants
                        ).map(st => (
                          <option key={st} value={st}>{st}</option>
                        ))}
                      </select>
                    </div>
                    <button 
                      className="ghost-btn" 
                      onClick={() => setShowCreateST(true)}
                      style={{ marginTop: 12, fontSize: 13, color: '#7c3aed' }}
                    >
                      + Créer un nouveau sous-traitant
                    </button>
                  </>
                ) : (
                  <>
                    <div className="input-group">
                      <label>Nom du nouveau sous-traitant</label>
                      <input
                        type="text"
                        value={newSousTraitantName}
                        onChange={(e) => setNewSousTraitantName(e.target.value)}
                        placeholder="Ex: EXPRESS DELIVERY"
                        style={{ width: '100%' }}
                      />
                    </div>
                    <button 
                      className="ghost-btn" 
                      onClick={() => { setShowCreateST(false); setNewSousTraitantName('') }}
                      style={{ marginTop: 8, fontSize: 13, color: '#888' }}
                    >
                      ← Retour à la liste
                    </button>
                  </>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'flex-end' }}>
              <button 
                className="ghost-btn" 
                onClick={() => {
                  setUnknownChauffeurModal({ 
                    show: false, chauffeur: '', filename: '', pendingFile: null, 
                    sousTraitants: [], existingChauffeurs: [], similarChauffeurs: [] 
                  })
                  setShowCreateST(false)
                  setNewSousTraitantName('')
                  setSelectedAssociation('')
                  setSelectedExistingChauffeur('')
                  setAssociationType('new')
                }}
              >
                Annuler
              </button>
              <button 
                className="btn"
                onClick={handleAssociateChauffeur}
                disabled={
                  (associationType === 'existing' && !selectedExistingChauffeur) ||
                  (associationType === 'new' && !selectedAssociation && !newSousTraitantName.trim())
                }
              >
                ✓ Confirmer et importer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === Modal MULTI-chauffeurs Cainiao PDF === */}
      {caniaoMultiModal.show && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'var(--surface)',
            borderRadius: 12,
            padding: 24,
            width: '90%',
            maxWidth: 600,
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)'
          }}>
            <h3 style={{ margin: '0 0 8px 0', color: '#f59e0b' }}>⚠️ Chauffeurs non reconnus</h3>
            <p style={{ margin: '0 0 16px 0', color: '#aaa', fontSize: 14 }}>
              {caniaoMultiModal.unknownChauffeurs.length} chauffeur(s) doivent être associés à un sous-traitant.
            </p>

            {/* Liste des chauffeurs à associer */}
            <div style={{ maxHeight: 400, overflow: 'auto' }}>
              {caniaoMultiModal.unknownChauffeurs.map((unknown, idx) => {
                const assoc = caniaoAssociations[unknown.chauffeur] || { type: 'new', sousTraitant: '' }
                
                return (
                  <div key={idx} style={{ 
                    background: 'var(--panel)', 
                    borderRadius: 8, 
                    padding: 16, 
                    marginBottom: 12 
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontWeight: 'bold', color: '#fff' }}>🚗 {unknown.chauffeur}</span>
                      <span style={{ fontSize: 12, color: '#888' }}>Plage: {unknown.plage}</span>
                    </div>
                    
                    {/* Suggestions si chauffeurs similaires */}
                    {unknown.similarChauffeurs && unknown.similarChauffeurs.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <span style={{ fontSize: 12, color: '#888' }}>Peut-être :</span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                          {unknown.similarChauffeurs.slice(0, 3).map((similar: any, sIdx: number) => (
                            <button
                              key={sIdx}
                              onClick={() => setCaniaoAssociations(prev => ({
                                ...prev,
                                [unknown.chauffeur]: { type: 'existing', sousTraitant: similar.sousTraitant, existingChauffeur: similar.name }
                              }))}
                              style={{
                                padding: '4px 10px',
                                borderRadius: 12,
                                border: 'none',
                                background: assoc.type === 'existing' && assoc.existingChauffeur === similar.name ? '#7c3aed' : '#333',
                                color: '#fff',
                                fontSize: 12,
                                cursor: 'pointer'
                              }}
                            >
                              {similar.name} ({similar.sousTraitant})
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Sélection du type */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <button
                        onClick={() => setCaniaoAssociations(prev => ({
                          ...prev,
                          [unknown.chauffeur]: { type: 'existing', sousTraitant: '', existingChauffeur: '' }
                        }))}
                        style={{
                          flex: 1,
                          padding: '6px 10px',
                          border: 'none',
                          borderRadius: 6,
                          cursor: 'pointer',
                          background: assoc.type === 'existing' ? 'var(--accent)' : '#333',
                          color: assoc.type === 'existing' ? '#fff' : '#aaa',
                          fontSize: 12
                        }}
                      >
                        🔗 Existant
                      </button>
                      <button
                        onClick={() => setCaniaoAssociations(prev => ({
                          ...prev,
                          [unknown.chauffeur]: { type: 'new', sousTraitant: '', existingChauffeur: undefined }
                        }))}
                        style={{
                          flex: 1,
                          padding: '6px 10px',
                          border: 'none',
                          borderRadius: 6,
                          cursor: 'pointer',
                          background: assoc.type === 'new' ? 'var(--accent)' : '#333',
                          color: assoc.type === 'new' ? '#fff' : '#aaa',
                          fontSize: 12
                        }}
                      >
                        ➕ Nouveau
                      </button>
                    </div>
                    
                    {/* Sélection selon le type */}
                    {assoc.type === 'existing' ? (
                      <select
                        value={assoc.existingChauffeur || ''}
                        onChange={(e) => {
                          const selected = caniaoMultiModal.existingChauffeurs.find(c => c.name === e.target.value)
                          setCaniaoAssociations(prev => ({
                            ...prev,
                            [unknown.chauffeur]: { 
                              type: 'existing', 
                              sousTraitant: selected?.sousTraitant || '', 
                              existingChauffeur: e.target.value 
                            }
                          }))
                        }}
                        style={{ width: '100%', padding: 8, borderRadius: 6, background: '#222', border: '1px solid #444', color: '#fff' }}
                      >
                        <option value="">-- Sélectionner un chauffeur existant --</option>
                        {caniaoMultiModal.existingChauffeurs.map((c, cIdx) => (
                          <option key={cIdx} value={c.name}>{c.name} ({c.sousTraitant})</option>
                        ))}
                      </select>
                    ) : (
                      <select
                        value={assoc.sousTraitant || ''}
                        onChange={(e) => setCaniaoAssociations(prev => ({
                          ...prev,
                          [unknown.chauffeur]: { type: 'new', sousTraitant: e.target.value }
                        }))}
                        style={{ width: '100%', padding: 8, borderRadius: 6, background: '#222', border: '1px solid #444', color: '#fff' }}
                      >
                        <option value="">-- Sélectionner un sous-traitant --</option>
                        {(caniaoMultiModal.sousTraitants.length > 0 
                          ? caniaoMultiModal.sousTraitants 
                          : sousTraitants
                        ).map((st, stIdx) => (
                          <option key={stIdx} value={st}>{st}</option>
                        ))}
                      </select>
                    )}
                    
                    {/* Indicateur de validation */}
                    {((assoc.type === 'existing' && assoc.existingChauffeur) || (assoc.type === 'new' && assoc.sousTraitant)) && (
                      <p style={{ margin: '8px 0 0 0', fontSize: 12, color: '#4ade80' }}>
                        ✓ {assoc.type === 'existing' 
                          ? `Sera lié à "${assoc.existingChauffeur}"` 
                          : `Sera assigné à "${assoc.sousTraitant}"`}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Option pour créer un nouveau sous-traitant */}
            <div style={{ marginTop: 16, padding: 12, background: 'var(--panel)', borderRadius: 8 }}>
              <label style={{ fontSize: 12, color: '#888' }}>Créer un nouveau sous-traitant (optionnel)</label>
              <input
                type="text"
                value={caniaoNewST}
                onChange={(e) => setCaniaoNewST(e.target.value)}
                placeholder="Ex: EXPRESS DELIVERY"
                style={{ width: '100%', padding: 8, borderRadius: 6, background: '#222', border: '1px solid #444', color: '#fff', marginTop: 4 }}
              />
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'flex-end' }}>
              <button 
                className="ghost-btn" 
                onClick={() => {
                  setCaniaoMultiModal({
                    show: false,
                    unknownChauffeurs: [],
                    sousTraitants: [],
                    existingChauffeurs: [],
                    pendingFile: null,
                    filename: ''
                  })
                  setCaniaoAssociations({})
                  setCaniaoNewST('')
                  setCaniaoFile(null)
                }}
              >
                Annuler
              </button>
              <button 
                className="btn"
                onClick={handleCaniaoMultiAssociation}
                disabled={caniaoMultiModal.unknownChauffeurs.some(u => {
                  const assoc = caniaoAssociations[u.chauffeur]
                  return !assoc || 
                    (assoc.type === 'existing' && !assoc.existingChauffeur) ||
                    (assoc.type === 'new' && !assoc.sousTraitant)
                })}
              >
                ✓ Confirmer et importer
              </button>
            </div>
          </div>
        </div>
      )}
      {importProgress && (
        <div style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          background: 'var(--surface)',
          borderRadius: 8,
          padding: 16,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          zIndex: 999
        }}>
          <p style={{ margin: 0, fontWeight: 'bold' }}>
            Import en cours: {importProgress.current}/{importProgress.total}
          </p>
          <div style={{
            width: 200,
            height: 4,
            background: '#333',
            borderRadius: 2,
            marginTop: 8,
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${(importProgress.current / importProgress.total) * 100}%`,
              height: '100%',
              background: '#7c3aed',
              transition: 'width 0.3s'
            }} />
          </div>
        </div>
      )}
    </div>
  )
}

// =====================
// MAIN COMPONENT
// =====================
export function ToursImport() {
  const { user } = useAuth()
  if (user?.role === 'DISPATCHER') return <DispatcherView />
  return <AdminView />
}
