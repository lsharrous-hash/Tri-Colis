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

interface UnifiedFile {
  file: File
  detectedType: 'gofo' | 'caniao' | 'mutualized' | 'unknown' | 'detecting'
  confidence: number
  isMultiChauffeur?: boolean
  chauffeurName?: string
  manualOverride?: boolean
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

  // === État pour le modal MULTI-chauffeurs GOFO ===
  const [gofoMultiModal, setGofoMultiModal] = useState<{
    show: boolean
    unknownChauffeurs: { filename: string; chauffeur: string; similarChauffeurs: any[] }[]
    knownChauffeurs: { filename: string; chauffeur: string; sousTraitant: string }[]
    sousTraitants: string[]
    existingChauffeurs: { name: string; sousTraitant: string; normalized: string }[]
    pendingFiles: File[]
  }>({
    show: false,
    unknownChauffeurs: [],
    knownChauffeurs: [],
    sousTraitants: [],
    existingChauffeurs: [],
    pendingFiles: []
  })
  const [gofoAssociations, setGofoAssociations] = useState<Record<string, { type: 'new' | 'existing'; sousTraitant: string; existingChauffeur?: string; createNewST?: boolean; newSTName?: string }>>({})
  const [gofoCreatingNewST, setGofoCreatingNewST] = useState<string | null>(null)

  // === État pour le modal de patterns de tracking inconnus ===
  const [unknownPatternsModal, setUnknownPatternsModal] = useState<{
    show: boolean
    unknownPrefixes: { prefix: string; count: number; examples: string[] }[]
    expectedType: 'gofo' | 'caniao' | null
    pendingAction: (() => void) | null
  }>({
    show: false,
    unknownPrefixes: [],
    expectedType: null,
    pendingAction: null
  })
  const [patternAssignments, setPatternAssignments] = useState<Record<string, 'gofo' | 'caniao' | 'autre'>>({})

  // === État pour le FORMULAIRE UNIFIÉ avec détection automatique ===
  const [unifiedFiles, setUnifiedFiles] = useState<UnifiedFile[]>([])
  const [isUnifiedDragging, setIsUnifiedDragging] = useState(false)
  const [unifiedSousTraitant, setUnifiedSousTraitant] = useState<string>('')
  const [isDetecting, setIsDetecting] = useState(false)

  // Fonction pour détecter le type d'un fichier via l'API
  const detectFileType = async (file: File): Promise<Partial<UnifiedFile>> => {
    try {
      console.log('🔍 Détection type pour:', file.name)
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await api.post('/api/file/detect-type', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      console.log('✅ Résultat détection:', file.name, data)
      return {
        detectedType: data.type || 'unknown',
        confidence: data.confidence || 0,
        isMultiChauffeur: data.isMultiChauffeur || false,
        chauffeurName: data.chauffeurName || null
      }
    } catch (err: any) {
      console.error('❌ Erreur détection type:', file.name, err?.response?.data || err?.message)
      return { detectedType: 'unknown', confidence: 0 }
    }
  }

  // Ajouter des fichiers et détecter leur type automatiquement
  const addUnifiedFiles = async (newFiles: File[]) => {
    setIsDetecting(true)
    
    // Créer un tableau avec les résultats de détection
    const detectedFiles: UnifiedFile[] = []
    
    for (const file of newFiles) {
      console.log('🔄 Traitement fichier:', file.name)
      
      // Détecter le type
      const detection = await detectFileType(file)
      
      detectedFiles.push({
        file,
        detectedType: detection.detectedType || 'unknown',
        confidence: detection.confidence || 0,
        isMultiChauffeur: detection.isMultiChauffeur,
        chauffeurName: detection.chauffeurName
      })
    }
    
    // Ajouter tous les fichiers détectés en une seule fois
    setUnifiedFiles(prev => [...prev, ...detectedFiles])
    setIsDetecting(false)
    
    console.log('✅ Tous les fichiers traités:', detectedFiles.map(f => `${f.file.name} → ${f.detectedType}`))
  }

  // Supprimer un fichier unifié
  const removeUnifiedFile = (index: number) => {
    setUnifiedFiles(prev => prev.filter((_, i) => i !== index))
  }

  // Changer manuellement le type d'un fichier
  const setFileType = (index: number, type: 'gofo' | 'caniao' | 'mutualized') => {
    setUnifiedFiles(prev => {
      const updated = [...prev]
      if (updated[index]) {
        updated[index] = {
          ...updated[index],
          detectedType: type,
          manualOverride: true
        }
      }
      return updated
    })
  }

  // === État pour le modal de confirmation type mismatch ===
  const [typeMismatchModal, setTypeMismatchModal] = useState<{
    show: boolean
    detectedType: string
    expectedType: string
    mismatchCount: number
    examples: string[]
    totalColis: number
    pendingAction: (() => void) | null
    importType: 'gofo' | 'caniao'
  }>({
    show: false,
    detectedType: '',
    expectedType: '',
    mismatchCount: 0,
    examples: [],
    totalColis: 0,
    pendingAction: null,
    importType: 'gofo'
  })

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
      
      // ÉTAPE 1: Vérifier tous les chauffeurs d'abord
      const filenames = files.map(f => f.name)
      const checkResponse = await api.post('/api/chauffeurs/check-batch', { filenames })
      const { known, unknown, sousTraitants: stList, existingChauffeurs } = checkResponse.data
      
      // Si des chauffeurs inconnus, afficher le modal multi-chauffeurs
      if (unknown.length > 0) {
        setGofoMultiModal({
          show: true,
          unknownChauffeurs: unknown,
          knownChauffeurs: known,
          sousTraitants: stList,
          existingChauffeurs: existingChauffeurs,
          pendingFiles: [...files]
        })
        // Initialiser les associations par défaut
        const initialAssociations: Record<string, any> = {}
        for (const u of unknown) {
          initialAssociations[u.chauffeur] = {
            type: u.similarChauffeurs?.length > 0 ? 'existing' : 'new',
            sousTraitant: '',
            existingChauffeur: ''
          }
        }
        setGofoAssociations(initialAssociations)
        return { needsAssociation: true, unknown: unknown.length }
      }
      
      // ÉTAPE 2: Tous les chauffeurs sont connus, importer directement
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
          
          // Patterns de tracking inconnus - afficher le modal (arrête l'import pour apprendre le pattern)
          if (errorData?.error === 'UNKNOWN_TRACKING_PATTERNS') {
            setUnknownPatternsModal({
              show: true,
              unknownPrefixes: errorData.unknownPrefixes || [],
              expectedType: errorData.expectedType || 'gofo',
              pendingAction: () => normalMutation.mutate()
            })
            // Initialiser les assignations avec le type attendu par défaut
            const initialAssignments: Record<string, 'gofo' | 'caniao' | 'autre'> = {}
            for (const up of (errorData.unknownPrefixes || [])) {
              initialAssignments[up.prefix] = errorData.expectedType || 'gofo'
            }
            setPatternAssignments(initialAssignments)
            return { results: [], hasUnknownPatterns: true }
          }
          
          // Type mismatch - NE PAS ARRÊTER, juste ajouter aux erreurs et continuer
          if (errorData?.error === 'TYPE_MISMATCH') {
            results.push({ 
              success: false, 
              file: file.name, 
              error: `⚠️ Fichier ${errorData.detectedType?.toUpperCase() || 'inconnu'} détecté (pas Gofo)`,
              isTypeMismatch: true,
              detectedType: errorData.detectedType
            })
            // Continuer avec les autres fichiers
            continue
          }
          
          results.push({ 
            success: false, 
            file: file.name, 
            error: errorData?.message || err?.message || 'Erreur inconnue' 
          })
        }
      }
      
      return { partial: false, results, remaining: 0 }
    },
    onSuccess: (data: any) => {
      setImportProgress(null)
      
      // Cas: patterns inconnus - le modal est déjà affiché
      if (data.hasUnknownPatterns) {
        return
      }
      
      // Cas: besoin d'association - le modal est déjà affiché
      if (data.needsAssociation) {
        return
      }
      
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
      
      // Séparer les erreurs de type mismatch des autres erreurs
      const typeMismatchResults = failedResults.filter((r: any) => r.isTypeMismatch)
      const otherErrors = failedResults.filter((r: any) => !r.isTypeMismatch)
      
      // Séparer les imports avec nouveaux colis des fusions sans nouveaux colis
      const newImports = successResults.filter((r: any) => !r.result?.alreadyExists)
      const fusionImports = successResults.filter((r: any) => r.result?.alreadyExists)
      
      const totalColis = newImports.reduce((sum: number, r: any) => sum + (r.result?.tour?.colisCount || r.result?.colisCount || 0), 0)
      const totalDuplicates = newImports.reduce((sum: number, r: any) => 
        sum + (r.result?.duplicatesIgnored || 0) + (r.result?.duplicatesInFileIgnored || 0), 0
      )
      const fusionColis = fusionImports.reduce((sum: number, r: any) => sum + (r.result?.totalInFile || 0), 0)
      
      let message = `✅ ${newImports.length} tournée(s) importée(s): ${totalColis} colis`
      if (totalDuplicates > 0) {
        message += ` (${totalDuplicates} doublons ignorés)`
      }
      if (fusionImports.length > 0) {
        message += `\n\nℹ️ ${fusionImports.length} fichier(s) fusionné(s): ${fusionColis} colis déjà présents`
      }
      if (typeMismatchResults.length > 0) {
        message += `\n\n🚫 ${typeMismatchResults.length} fichier(s) ignoré(s) (mauvais type):\n` + 
          typeMismatchResults.map((r: any) => `• ${r.file} → ${r.detectedType?.toUpperCase() || 'inconnu'} (utilisez l'import ${r.detectedType?.toUpperCase() || 'approprié'})`).join('\n')
      }
      if (otherErrors.length > 0) {
        message += `\n\n⚠️ ${otherErrors.length} erreur(s):\n` + 
          otherErrors.map((r: any) => `• ${r.file}: ${r.error}`).join('\n')
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
          
          // Retirer le fichier traité de unifiedFiles aussi
          const remainingUnified = unifiedFiles.filter(f => f.file.name !== unknownChauffeurModal.filename)
          setUnifiedFiles(remainingUnified)
          
          const linkedMsg = associationType === 'existing' 
            ? ` (lié à ${selectedExistingChauffeur})`
            : ''
          
          // S'il reste des fichiers caniaoExcel, continuer avec caniaoExcelMutation
          if (caniaoExcelFiles.length > 1) {
            alert(`✅ Tournée Cainiao importée pour ${unknownChauffeurModal.chauffeur}${linkedMsg} → ${finalST}\n\n⏳ Traitement des fichiers suivants...`)
            setTimeout(() => caniaoExcelMutation.mutate(), 100)
          } 
          // Sinon, s'il reste des fichiers unifiés, relancer l'import unifié
          else if (remainingUnified.length > 0) {
            setCaniaoExcelFiles([])
            alert(`✅ Tournée Cainiao importée pour ${unknownChauffeurModal.chauffeur}${linkedMsg} → ${finalST}\n\n📋 ${remainingUnified.length} fichier(s) restant(s). Cliquez sur Importer pour continuer.`)
            // Les fichiers restants seront importés au prochain clic
          } else {
            setCaniaoExcelFiles([])
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
          
          // Retirer le fichier traité de unifiedFiles aussi
          const remainingUnified = unifiedFiles.filter(f => f.file.name !== unknownChauffeurModal.filename)
          setUnifiedFiles(remainingUnified)
          
          const linkedMsg = associationType === 'existing' 
            ? ` (lié à ${selectedExistingChauffeur})`
            : ''
          
          // S'il reste des fichiers, relancer l'import
          if (files.length > 1) {
            alert(`✅ Tournée importée pour ${unknownChauffeurModal.chauffeur}${linkedMsg} → ${finalST}\n\n⏳ Traitement des fichiers suivants...`)
            setTimeout(() => normalMutation.mutate(), 100)
          }
          // Sinon, s'il reste des fichiers unifiés, relancer l'import unifié
          else if (remainingUnified.length > 0) {
            setFiles([])
            alert(`✅ Tournée importée pour ${unknownChauffeurModal.chauffeur}${linkedMsg} → ${finalST}\n\n📋 ${remainingUnified.length} fichier(s) restant(s). Cliquez sur Importer pour continuer.`)
            // Les fichiers restants seront importés au prochain clic
          } else {
            setFiles([])
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
    
    // Créer d'abord les nouveaux sous-traitants si nécessaire
    const newSousTraitantsToCreate = new Set<string>()
    
    // Collecter les sous-traitants à créer depuis le champ global
    if (caniaoNewST.trim()) {
      newSousTraitantsToCreate.add(caniaoNewST.trim())
    }
    
    // Collecter les sous-traitants à créer depuis les associations inline
    for (const unknown of caniaoMultiModal.unknownChauffeurs) {
      const assoc = caniaoAssociations[unknown.chauffeur] as any
      if (assoc?.type === 'new' && assoc?.createNew && assoc?.sousTraitant?.trim()) {
        newSousTraitantsToCreate.add(assoc.sousTraitant.trim())
      }
    }
    
    // Créer tous les nouveaux sous-traitants
    for (const stName of newSousTraitantsToCreate) {
      try {
        await api.post('/api/sous-traitants', { name: stName })
      } catch (err: any) {
        if (err?.response?.data?.error !== 'ALREADY_EXISTS') {
          alert(`Erreur création sous-traitant "${stName}": ${err?.response?.data?.message || err?.message}`)
          return
        }
      }
    }
    
    if (newSousTraitantsToCreate.size > 0) {
      await refetchSousTraitants()
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
    
    // Relancer l'import pour TOUS les fichiers en attente
    const filesToProcess = [...caniaoExcelFiles]
    if (filesToProcess.length === 0 && caniaoMultiModal.pendingFile) {
      filesToProcess.push(caniaoMultiModal.pendingFile)
    }
    
    if (filesToProcess.length > 0) {
      let totalTours = 0
      let totalColis = 0
      const errors: string[] = []
      
      for (const file of filesToProcess) {
        try {
          const data = await uploadTourCaniao(file, selectedDate)
          totalTours += data.tours?.length || 0
          totalColis += data.totalColisImported || 0
        } catch (err: any) {
          errors.push(`${file.name}: ${err?.response?.data?.message || err?.message}`)
        }
      }
      
      // Vider les fichiers Cainiao PDF traités, garder les autres
      setCaniaoExcelFiles([])
      setCaniaoFile(null)
      
      // Garder les fichiers Cainiao uni-chauffeur (Excel) et autres non traités
      const remainingFiles = unifiedFiles.filter(f => 
        // Garder les fichiers qui ne sont pas des PDF Cainiao déjà traités
        !(f.detectedType === 'caniao' && f.file.name.toLowerCase().endsWith('.pdf'))
      )
      setUnifiedFiles(remainingFiles)
      
      qc.invalidateQueries({ queryKey: ['tours'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
      
      let message = ''
      if (errors.length > 0) {
        message = `✅ Import partiel: ${totalTours} tournée(s), ${totalColis} colis\n\n⚠️ Erreurs:\n${errors.join('\n')}`
      } else {
        message = `✅ Import CANIAO PDF réussi: ${totalTours} tournée(s), ${totalColis} colis`
      }
      
      // Si des fichiers restent (Excel Cainiao, Gofo, etc.), continuer l'import
      if (remainingFiles.length > 0) {
        message += `\n\n📋 ${remainingFiles.length} fichier(s) restant(s). Cliquez sur Importer pour continuer.`
        alert(message)
        // Les fichiers restants seront importés au prochain clic
      } else {
        alert(message)
      }
    }
  }

  // Fonction pour associer plusieurs chauffeurs GOFO et importer
  const handleGofoMultiAssociation = async () => {
    // Vérifier que tous les chauffeurs ont une association
    for (const unknown of gofoMultiModal.unknownChauffeurs) {
      const assoc = gofoAssociations[unknown.chauffeur]
      if (!assoc) {
        alert(`Veuillez configurer l'association pour ${unknown.chauffeur}`)
        return
      }
      if (assoc.type === 'new') {
        if (assoc.createNewST && !assoc.newSTName?.trim()) {
          alert(`Veuillez entrer le nom du nouveau sous-traitant pour ${unknown.chauffeur}`)
          return
        }
        if (!assoc.createNewST && !assoc.sousTraitant) {
          alert(`Veuillez sélectionner un sous-traitant pour ${unknown.chauffeur}`)
          return
        }
      }
      if (assoc.type === 'existing' && !assoc.existingChauffeur) {
        alert(`Veuillez sélectionner un chauffeur existant pour ${unknown.chauffeur}`)
        return
      }
    }
    
    try {
      // 1. Créer les nouveaux sous-traitants si nécessaire
      const newSousTraitantsToCreate = new Set<string>()
      for (const unknown of gofoMultiModal.unknownChauffeurs) {
        const assoc = gofoAssociations[unknown.chauffeur]
        if (assoc?.type === 'new' && assoc.createNewST && assoc.newSTName?.trim()) {
          newSousTraitantsToCreate.add(assoc.newSTName.trim())
        }
      }
      
      for (const stName of newSousTraitantsToCreate) {
        try {
          await api.post('/api/sous-traitants', { name: stName })
        } catch (err: any) {
          if (!err?.response?.data?.message?.includes('existe')) {
            console.error('Erreur création ST:', err)
          }
        }
      }
      
      // 2. Créer les associations chauffeur → sous-traitant
      for (const unknown of gofoMultiModal.unknownChauffeurs) {
        const assoc = gofoAssociations[unknown.chauffeur]
        let finalST = ''
        
        if (assoc.type === 'existing') {
          const existing = gofoMultiModal.existingChauffeurs.find(c => c.name === assoc.existingChauffeur)
          finalST = existing?.sousTraitant || ''
        } else {
          finalST = assoc.createNewST ? assoc.newSTName?.trim() || '' : assoc.sousTraitant
        }
        
        if (finalST) {
          await api.post('/api/chauffeurs', { name: unknown.chauffeur, sousTraitant: finalST })
        }
      }
      
      // 3. Fermer le modal
      setGofoMultiModal({
        show: false,
        unknownChauffeurs: [],
        knownChauffeurs: [],
        sousTraitants: [],
        existingChauffeurs: [],
        pendingFiles: []
      })
      setGofoAssociations({})
      
      // 4. Importer tous les fichiers
      const results: any[] = []
      const pendingFiles = gofoMultiModal.pendingFiles
      
      setImportProgress({ current: 0, total: pendingFiles.length, results: [] })
      
      for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i]
        setImportProgress(prev => prev ? { ...prev, current: i + 1 } : null)
        
        try {
          const result = await uploadTour(file, selectedDate, '')
          results.push({ success: true, file: file.name, result })
        } catch (err: any) {
          const errorData = err?.response?.data
          results.push({ 
            success: false, 
            file: file.name, 
            error: errorData?.message || err?.message || 'Erreur inconnue' 
          })
        }
      }
      
      setImportProgress(null)
      setFiles([])
      
      // Ne vider que les fichiers Gofo, garder les Cainiao
      const remainingCaniaoFiles = unifiedFiles.filter(f => f.detectedType === 'caniao')
      setUnifiedFiles(remainingCaniaoFiles)
      
      qc.invalidateQueries({ queryKey: ['tours'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
      qc.invalidateQueries({ queryKey: ['sous-traitants'] })
      qc.invalidateQueries({ queryKey: ['chauffeurs'] })
      
      const successResults = results.filter(r => r.success)
      const failedResults = results.filter(r => !r.success)
      
      // Séparer les imports avec nouveaux colis des fusions sans nouveaux colis
      const newImports = successResults.filter((r: any) => !r.result?.alreadyExists)
      const fusionImports = successResults.filter((r: any) => r.result?.alreadyExists)
      
      const totalColis = newImports.reduce((sum, r) => sum + (r.result?.tour?.colisCount || r.result?.colisCount || 0), 0)
      const fusionColis = fusionImports.reduce((sum, r) => sum + (r.result?.totalInFile || 0), 0)
      
      let message = `✅ ${newImports.length} tournée(s) Gofo importée(s): ${totalColis} colis`
      if (fusionImports.length > 0) {
        message += `\n\nℹ️ ${fusionImports.length} fichier(s) fusionné(s): ${fusionColis} colis déjà présents`
      }
      if (failedResults.length > 0) {
        message += `\n\n⚠️ ${failedResults.length} erreur(s):\n` + 
          failedResults.map(r => `• ${r.file}: ${r.error}`).join('\n')
      }
      
      // Si des fichiers Cainiao restent, continuer l'import automatiquement
      if (remainingCaniaoFiles.length > 0) {
        message += `\n\n📋 ${remainingCaniaoFiles.length} fichier(s) Cainiao restant(s). Cliquez sur Importer pour continuer.`
        alert(message)
        // Relancer l'import unifié pour traiter les Cainiao
        // Les fichiers restants seront importés au prochain clic
      } else {
        alert(message)
      }
      
    } catch (err: any) {
      alert(`Erreur: ${err?.response?.data?.message || err?.message}`)
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

  // === MODAL DE CONFIRMATION DOUBLONS ===
  const [duplicateWarningModal, setDuplicateWarningModal] = useState<{
    show: boolean
    existingTours: string[]  // Chauffeurs avec tournées existantes
    duplicatesInImport: string[]  // Chauffeurs en doublon dans l'import
    importType: 'gofo' | 'cainiao'
  }>({
    show: false,
    existingTours: [],
    duplicatesInImport: [],
    importType: 'cainiao'
  })

  // === FONCTIONS DE VÉRIFICATION DES PATTERNS DE TRACKING ===
  
  // La vérification des patterns se fait maintenant côté backend
  // Si des patterns inconnus sont détectés, le backend retourne une erreur spécifique
  // et le frontend affiche le modal pour les associer

  // Sauvegarder les nouveaux patterns et continuer l'import
  const saveUnknownPatternsAndContinue = async () => {
    try {
      // Sauvegarder chaque nouveau pattern
      for (const [prefix, type] of Object.entries(patternAssignments)) {
        await api.post('/api/tracking-patterns', {
          prefix,
          type,
          description: `Ajouté lors de l'import - ${new Date().toLocaleDateString('fr-FR')}`
        })
      }
      
      // Récupérer l'action en attente avant de fermer le modal
      const pendingAction = unknownPatternsModal.pendingAction
      
      // Fermer le modal
      setUnknownPatternsModal({
        show: false,
        unknownPrefixes: [],
        expectedType: null,
        pendingAction: null
      })
      setPatternAssignments({})
      
      // Exécuter l'action en attente (relancer l'import)
      if (pendingAction) {
        pendingAction()
      }
    } catch (error) {
      console.error('Erreur sauvegarde patterns:', error)
      alert('Erreur lors de la sauvegarde des patterns')
    }
  }

  // Forcer l'import Gofo malgré le type mismatch
  const forceGofoImport = async () => {
    setTypeMismatchModal(prev => ({ ...prev, show: false }))
    
    if (files.length === 0 || !selectedDate) return
    
    const results: any[] = []
    setImportProgress({ current: 0, total: files.length, results: [] })
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setImportProgress(prev => prev ? { ...prev, current: i + 1 } : null)
      
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('date', selectedDate)
        if (sousTraitant) formData.append('sousTraitantName', sousTraitant)
        
        const { data } = await api.post('/api/tours/import', formData, {
          headers: { 
            'Content-Type': 'multipart/form-data',
            'X-Force-Import': 'true'
          },
        })
        results.push({ success: true, file: file.name, result: data })
      } catch (err: any) {
        results.push({ 
          success: false, 
          file: file.name, 
          error: err?.response?.data?.message || err?.message || 'Erreur' 
        })
      }
    }
    
    setImportProgress(null)
    setFiles([])
    setSousTraitant('')
    qc.invalidateQueries({ queryKey: ['tours'] })
    qc.invalidateQueries({ queryKey: ['stats'] })
    qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
    
    const successCount = results.filter(r => r.success).length
    const failedCount = results.filter(r => !r.success).length
    alert(`Import forcé terminé: ${successCount} réussi(s), ${failedCount} échec(s)`)
  }

  // Forcer l'import Cainiao malgré le type mismatch
  const forceCaniaoImport = async () => {
    setTypeMismatchModal(prev => ({ ...prev, show: false }))
    
    if (caniaoExcelFiles.length === 0 || !selectedDate) return
    
    const results: any[] = []
    
    for (const file of caniaoExcelFiles) {
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('date', selectedDate)
        if (caniaoExcelSousTraitant) formData.append('sousTraitantName', caniaoExcelSousTraitant)
        
        const { data } = await api.post('/api/tours/import/caniao-excel', formData, {
          headers: { 
            'Content-Type': 'multipart/form-data',
            'X-Force-Import': 'true'
          },
        })
        results.push({ success: true, file: file.name, result: data })
      } catch (err: any) {
        results.push({ 
          success: false, 
          file: file.name, 
          error: err?.response?.data?.message || err?.message || 'Erreur' 
        })
      }
    }
    
    setCaniaoExcelFiles([])
    setCaniaoExcelSousTraitant('')
    qc.invalidateQueries({ queryKey: ['tours'] })
    qc.invalidateQueries({ queryKey: ['stats'] })
    qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
    
    const successCount = results.filter(r => r.success).length
    const failedCount = results.filter(r => !r.success).length
    alert(`Import forcé terminé: ${successCount} réussi(s), ${failedCount} échec(s)`)
  }

  // Fonction pour extraire les noms de chauffeurs des fichiers à importer
  const extractDriverNamesFromFiles = (files: File[]): string[] => {
    const names: string[] = []
    for (const file of files) {
      // Extraire le nom du fichier sans extension ni date
      const filename = file.name.replace(/\.(pdf|xlsx)$/i, '')
      // Pattern: NomChauffeur_JJ_MM ou NomChauffeur JJ-MM ou juste NomChauffeur
      const match = filename.match(/^([a-zA-ZÀ-ÿ\-_']+)/i)
      if (match) {
        const name = match[1].replace(/[_-]/g, ' ').trim()
        if (name.length >= 2) {
          names.push(name.charAt(0).toUpperCase() + name.slice(1).toLowerCase())
        }
      }
    }
    return names
  }

  // Fonction pour vérifier les doublons avant import Cainiao (appelée après vérification patterns)
  const checkCaniaoImportDuplicatesInternal = () => {
    if (caniaoExcelFiles.length === 0 || !selectedDate) return
    
    // 1. Extraire les noms des fichiers à importer
    const importNames = extractDriverNamesFromFiles(caniaoExcelFiles)
    
    // 2. Vérifier les doublons dans l'import lui-même
    const nameCounts: Record<string, number> = {}
    for (const name of importNames) {
      const normalized = name.toLowerCase()
      nameCounts[normalized] = (nameCounts[normalized] || 0) + 1
    }
    const duplicatesInImport = Object.entries(nameCounts)
      .filter(([_, count]) => count > 1)
      .map(([name]) => name.charAt(0).toUpperCase() + name.slice(1))
    
    // 3. Vérifier les tournées Cainiao existantes pour cette date
    const existingCaniaoNames = caniaoTours.map((t: any) => t.chauffeurName?.toLowerCase() || '')
    const conflictingNames = importNames.filter(name => 
      existingCaniaoNames.includes(name.toLowerCase())
    )
    
    // 4. Si des conflits, afficher le modal
    if (duplicatesInImport.length > 0 || conflictingNames.length > 0) {
      setDuplicateWarningModal({
        show: true,
        existingTours: [...new Set(conflictingNames)],
        duplicatesInImport: [...new Set(duplicatesInImport)],
        importType: 'cainiao'
      })
    } else {
      // Pas de conflit, lancer l'import directement
      caniaoUnifiedMutation.mutate()
    }
  }

  // Fonction wrapper qui vérifie d'abord les patterns puis les doublons
  const checkCaniaoImportDuplicates = () => {
    if (caniaoExcelFiles.length === 0 || !selectedDate) return
    checkCaniaoImportDuplicatesInternal()
  }

  // Fonction pour vérifier les doublons avant import Gofo (appelée après vérification patterns)
  const checkGofoImportDuplicatesInternal = () => {
    if (files.length === 0 || !selectedDate) return
    
    // 1. Extraire les noms des fichiers à importer
    const importNames = extractDriverNamesFromFiles(files)
    
    // 2. Vérifier les doublons dans l'import lui-même
    const nameCounts: Record<string, number> = {}
    for (const name of importNames) {
      const normalized = name.toLowerCase()
      nameCounts[normalized] = (nameCounts[normalized] || 0) + 1
    }
    const duplicatesInImport = Object.entries(nameCounts)
      .filter(([_, count]) => count > 1)
      .map(([name]) => name.charAt(0).toUpperCase() + name.slice(1))
    
    // 3. Vérifier les tournées Gofo existantes pour cette date
    const existingGofoNames = normalTours.map((t: any) => t.chauffeurName?.toLowerCase() || '')
    const conflictingNames = importNames.filter(name => 
      existingGofoNames.includes(name.toLowerCase())
    )
    
    // 4. Si des conflits, afficher le modal
    if (duplicatesInImport.length > 0 || conflictingNames.length > 0) {
      setDuplicateWarningModal({
        show: true,
        existingTours: [...new Set(conflictingNames)],
        duplicatesInImport: [...new Set(duplicatesInImport)],
        importType: 'gofo'
      })
    } else {
      // Pas de conflit, lancer l'import directement
      normalMutation.mutate()
    }
  }

  // Fonction wrapper qui vérifie d'abord les patterns puis les doublons
  const checkGofoImportDuplicates = () => {
    if (files.length === 0 || !selectedDate) return
    checkGofoImportDuplicatesInternal()
  }

  // MUTATION UNIFIÉE CAINIAO - Gère PDF multi-chauffeurs ET Excel/PDF uni-chauffeur
  const caniaoUnifiedMutation = useMutation({
    mutationFn: async () => {
      if (caniaoExcelFiles.length === 0) throw new Error('Aucun fichier sélectionné')
      if (!selectedDate) throw new Error('Date requise')
      
      const results: any[] = []
      const uniChauffeurFiles: File[] = []
      const pendingFilesWithUnknowns: { file: File; unknownChauffeurs: any[]; existingChauffeurs: string[]; sousTraitants: string[] }[] = []
      
      // Séparer PDF et Excel
      const pdfFiles = caniaoExcelFiles.filter(f => f.name.toLowerCase().endsWith('.pdf'))
      const excelFiles = caniaoExcelFiles.filter(f => f.name.toLowerCase().endsWith('.xlsx'))
      
      // Les Excel vont directement en uni-chauffeur
      uniChauffeurFiles.push(...excelFiles)
      
      // 1. Traiter TOUS les PDF comme potentiellement multi-chauffeurs
      // On ne s'arrête plus au premier fichier avec chauffeurs inconnus !
      for (const file of pdfFiles) {
        try {
          const data = await uploadTourCaniao(file, selectedDate)
          results.push({ 
            success: true, 
            file: file.name, 
            result: data,
            type: 'multi',
            toursCount: data.tours?.length || 0,
            colisCount: data.totalColisImported || 0
          })
        } catch (err: any) {
          const errorData = err?.response?.data
          
          // Si UNKNOWN_CHAUFFEURS, collecter pour plus tard (ne pas s'arrêter)
          if (errorData?.error === 'UNKNOWN_CHAUFFEURS') {
            pendingFilesWithUnknowns.push({
              file,
              unknownChauffeurs: errorData.unknownChauffeurs || [],
              existingChauffeurs: errorData.existingChauffeurs || [],
              sousTraitants: errorData.sousTraitants || sousTraitants
            })
          }
          // Si NO_PLAGES, basculer ce PDF vers uni-chauffeur
          else if (errorData?.error === 'NO_PLAGES' || errorData?.message?.includes('plage')) {
            uniChauffeurFiles.push(file)
          }
          // Type mismatch - NE PAS ARRÊTER, juste ajouter aux erreurs et continuer
          else if (errorData?.error === 'TYPE_MISMATCH') {
            results.push({ 
              success: false, 
              file: file.name, 
              error: `⚠️ Fichier ${errorData.detectedType?.toUpperCase() || 'inconnu'} détecté (pas Cainiao)`,
              type: 'multi',
              isTypeMismatch: true,
              detectedType: errorData.detectedType
            })
            // Continuer avec les autres fichiers
            continue
          }
          // Patterns inconnus - on doit arrêter pour apprendre le pattern
          else if (errorData?.error === 'UNKNOWN_TRACKING_PATTERNS') {
            setUnknownPatternsModal({
              show: true,
              unknownPrefixes: errorData.unknownPrefixes || [],
              expectedType: errorData.expectedType || 'caniao',
              pendingAction: () => caniaoUnifiedMutation.mutate()
            })
            const initialAssignments: Record<string, 'gofo' | 'caniao' | 'autre'> = {}
            for (const up of (errorData.unknownPrefixes || [])) {
              initialAssignments[up.prefix] = errorData.expectedType || 'caniao'
            }
            setPatternAssignments(initialAssignments)
            return { results: [], hasUnknownPatterns: true }
          }
          else {
            results.push({ 
              success: false, 
              file: file.name, 
              error: errorData?.message || err?.message || 'Erreur inconnue',
              type: 'multi'
            })
          }
        }
      }
      
      // 2. Traiter les fichiers uni-chauffeur (Excel ou PDF sans plages)
      const pendingUniFiles: { file: File; chauffeur: string; existingChauffeurs: string[]; similarChauffeurs: string[]; sousTraitants: string[] }[] = []
      
      for (const file of uniChauffeurFiles) {
        try {
          const formData = new FormData()
          formData.append('file', file)
          formData.append('date', selectedDate)
          if (caniaoExcelSousTraitant) {
            formData.append('sousTraitantName', caniaoExcelSousTraitant)
          }
          const { data } = await api.post('/api/tours/import/caniao-excel', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
          results.push({ success: true, file: file.name, result: data, type: 'uni' })
        } catch (err: any) {
          const errorData = err?.response?.data
          
          // Patterns de tracking inconnus - afficher le modal (arrête l'import pour apprendre le pattern)
          if (errorData?.error === 'UNKNOWN_TRACKING_PATTERNS') {
            setUnknownPatternsModal({
              show: true,
              unknownPrefixes: errorData.unknownPrefixes || [],
              expectedType: errorData.expectedType || 'caniao',
              pendingAction: () => caniaoUnifiedMutation.mutate()
            })
            // Initialiser les assignations avec le type attendu par défaut
            const initialAssignments: Record<string, 'gofo' | 'caniao' | 'autre'> = {}
            for (const up of (errorData.unknownPrefixes || [])) {
              initialAssignments[up.prefix] = errorData.expectedType || 'caniao'
            }
            setPatternAssignments(initialAssignments)
            return { results: [], hasUnknownPatterns: true }
          }
          
          // Type mismatch - NE PAS ARRÊTER, juste ajouter aux erreurs et continuer
          if (errorData?.error === 'TYPE_MISMATCH') {
            results.push({ 
              success: false, 
              file: file.name, 
              error: `⚠️ Fichier ${errorData.detectedType?.toUpperCase() || 'inconnu'} détecté (pas Cainiao)`,
              type: 'uni',
              isTypeMismatch: true,
              detectedType: errorData.detectedType
            })
            // Continuer avec les autres fichiers
            continue
          }
          
          // Chauffeur inconnu - collecter pour plus tard
          if (errorData?.error === 'UNKNOWN_CHAUFFEUR') {
            pendingUniFiles.push({
              file,
              chauffeur: errorData.chauffeur,
              existingChauffeurs: errorData.existingChauffeurs || [],
              similarChauffeurs: errorData.similarChauffeurs || [],
              sousTraitants: errorData.sousTraitants || sousTraitants
            })
          } else {
            results.push({ 
              success: false, 
              file: file.name, 
              error: errorData?.message || err?.message || 'Erreur inconnue',
              type: 'uni'
            })
          }
        }
      }
      
      // 3. Si des fichiers multi-chauffeurs ont des chauffeurs inconnus, afficher le modal unifié
      if (pendingFilesWithUnknowns.length > 0) {
        
        // Fusionner tous les chauffeurs inconnus de tous les fichiers
        const allUnknownChauffeurs: any[] = []
        const allExistingChauffeurs = new Set<string>()
        const allSousTraitants = new Set<string>()
        const allPendingFiles: File[] = []
        
        for (const pending of pendingFilesWithUnknowns) {
          allPendingFiles.push(pending.file)
          pending.existingChauffeurs.forEach(c => allExistingChauffeurs.add(c))
          pending.sousTraitants.forEach(s => allSousTraitants.add(s))
          
          for (const unknown of pending.unknownChauffeurs) {
            // Éviter les doublons
            if (!allUnknownChauffeurs.find(u => u.chauffeur === unknown.chauffeur)) {
              allUnknownChauffeurs.push({
                ...unknown,
                sourceFile: pending.file.name
              })
            }
          }
        }
        
        // Stocker tous les fichiers en attente
        setCaniaoExcelFiles(allPendingFiles)
        
        setCaniaoMultiModal({
          show: true,
          unknownChauffeurs: allUnknownChauffeurs,
          sousTraitants: Array.from(allSousTraitants),
          existingChauffeurs: Array.from(allExistingChauffeurs),
          pendingFile: allPendingFiles[0], // Premier fichier (pour compatibilité)
          filename: allPendingFiles.map(f => f.name).join(', ')
        })
        
        const initialAssociations: Record<string, { type: 'new' | 'existing'; sousTraitant: string; existingChauffeur?: string }> = {}
        for (const unknown of allUnknownChauffeurs) {
          initialAssociations[unknown.chauffeur] = { type: 'new', sousTraitant: '' }
        }
        setCaniaoAssociations(initialAssociations)
        
        return { 
          partial: true, 
          results, 
          remaining: allPendingFiles.length, 
          needsMultiModal: true,
          pendingUniFiles // Garder aussi les fichiers uni en attente
        }
      }
      
      // 4. Si des fichiers uni-chauffeur ont des chauffeurs inconnus
      if (pendingUniFiles.length > 0) {
        
        // Afficher le modal pour le premier fichier uni-chauffeur
        const first = pendingUniFiles[0]
        const remainingFiles = pendingUniFiles.map(p => p.file)
        setCaniaoExcelFiles(remainingFiles)
        setImportType('cainiao')
        
        setUnknownChauffeurModal({
          show: true,
          chauffeur: first.chauffeur,
          filename: first.file.name,
          pendingFile: first.file,
          sousTraitants: first.sousTraitants,
          existingChauffeurs: first.existingChauffeurs,
          similarChauffeurs: first.similarChauffeurs
        })
        setSelectedAssociation('')
        setSelectedExistingChauffeur('')
        setAssociationType(first.similarChauffeurs?.length > 0 ? 'existing' : 'new')
        
        return { partial: true, results, remaining: remainingFiles.length }
      }
      
      return { partial: false, results, remaining: 0 }
    },
    onSuccess: (data: any) => {
      // Cas: patterns inconnus - le modal est déjà affiché
      if (data.hasUnknownPatterns) {
        return
      }
      
      if (data.partial) {
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
      
      // Séparer les erreurs de type mismatch des autres erreurs
      const typeMismatchResults = failedResults.filter((r: any) => r.isTypeMismatch)
      const otherErrors = failedResults.filter((r: any) => !r.isTypeMismatch)
      
      // Calculer les totaux
      let totalTours = 0
      let totalColis = 0
      let alreadyExistsCount = 0
      let alreadyExistsColis = 0
      
      for (const r of successResults) {
        if (r.type === 'multi') {
          totalTours += r.toursCount || 0
          totalColis += r.colisCount || 0
        } else {
          // Vérifier si c'est une fusion sans nouveaux colis
          if (r.result?.alreadyExists) {
            alreadyExistsCount++
            alreadyExistsColis += r.result?.totalInFile || 0
          } else {
            totalTours += 1
            totalColis += r.result?.tour?.colisCount || r.result?.colisCount || 0
          }
        }
      }
      
      let message = `✅ ${totalTours} tournée(s) Cainiao importée(s): ${totalColis} colis`
      
      // Ajouter info sur les fusions sans nouveaux colis
      if (alreadyExistsCount > 0) {
        message += `\n\nℹ️ ${alreadyExistsCount} fichier(s) fusionné(s): ${alreadyExistsColis} colis déjà présents`
      }
      
      if (typeMismatchResults.length > 0) {
        message += `\n\n🚫 ${typeMismatchResults.length} fichier(s) ignoré(s) (mauvais type):\n` + 
          typeMismatchResults.map((r: any) => `• ${r.file} → ${r.detectedType?.toUpperCase() || 'inconnu'} (utilisez l'import ${r.detectedType?.toUpperCase() || 'approprié'})`).join('\n')
      }
      
      if (otherErrors.length > 0) {
        message += `\n\n⚠️ ${otherErrors.length} erreur(s):\n` + 
          otherErrors.map((r: any) => `• ${r.file}: ${r.error}`).join('\n')
      }
      alert(message)
    },
    onError: (err: any) => {
      alert(`Erreur: ${err?.response?.data?.message || err?.message}`)
    },
  })

  // =====================================================
  // IMPORT UNIFIÉ - Détection automatique Gofo/Cainiao
  // =====================================================
  const unifiedImportMutation = useMutation({
    mutationFn: async () => {
      if (unifiedFiles.length === 0) throw new Error('Aucun fichier sélectionné')
      if (!selectedDate) throw new Error('Date requise')
      
      const results: any[] = []
      
      // Séparer les fichiers par type
      const gofoFiles = unifiedFiles.filter(f => f.detectedType === 'gofo')
      const caniaoFiles = unifiedFiles.filter(f => f.detectedType === 'caniao')
      const mutualizedFiles = unifiedFiles.filter(f => f.detectedType === 'mutualized')
      const unknownFiles = unifiedFiles.filter(f => f.detectedType === 'unknown' || f.detectedType === 'detecting')
      
      // Avertir si des fichiers sont de type inconnu
      if (unknownFiles.length > 0) {
        for (const uf of unknownFiles) {
          results.push({
            success: false,
            file: uf.file.name,
            error: '❓ Type non détecté - veuillez sélectionner manuellement',
            sourceType: 'unknown'
          })
        }
      }
      
      // ===== IMPORTER LES FICHIERS MUTUALISÉS D'ABORD =====
      for (const uf of mutualizedFiles) {
        try {
          const formData = new FormData()
          formData.append('file', uf.file)
          formData.append('date', selectedDate)
          if (unifiedSousTraitant) {
            formData.append('sousTraitantName', unifiedSousTraitant)
          }
          
          const { data } = await api.post('/api/tours/import/mutualized', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          })
          
          results.push({
            success: true,
            file: uf.file.name,
            result: data,
            sourceType: 'mutualized',
            gofoCount: data.gofoCount || 0,
            caniaoCount: data.caniaoCount || 0
          })
        } catch (err: any) {
          const errorData = err?.response?.data
          
          // Chauffeur inconnu
          if (errorData?.error === 'UNKNOWN_CHAUFFEUR') {
            // Récupérer les chauffeurs existants
            let existingChauffeurs: any[] = []
            try {
              const { data } = await api.get('/api/chauffeurs')
              existingChauffeurs = data?.chauffeurs || []
            } catch (e) {}
            
            setGofoMultiModal({
              show: true,
              unknownChauffeurs: [{
                filename: uf.file.name,
                chauffeur: errorData.chauffeur,
                similarChauffeurs: errorData.similarChauffeurs || [],
                file: uf.file
              }],
              knownChauffeurs: [],
              sousTraitants: sousTraitants,
              existingChauffeurs: existingChauffeurs,
              pendingFiles: [uf.file]
            })
            
            setGofoAssociations({
              [errorData.chauffeur]: { type: 'new', sousTraitant: '' }
            })
            
            return { results, hasUnknownMutualized: true }
          }
          
          results.push({
            success: false,
            file: uf.file.name,
            error: errorData?.message || err?.message || 'Erreur import mutualisé',
            sourceType: 'mutualized'
          })
        }
      }
      
      // ===== COLLECTER LES CHAUFFEURS INCONNUS GOFO =====
      const gofoUnknownChauffeurs: { filename: string; chauffeur: string; similarChauffeurs: any[]; file: File }[] = []
      const gofoKnownChauffeurs: { filename: string; chauffeur: string; sousTraitant: string }[] = []
      
      // ===== IMPORTER LES FICHIERS GOFO =====
      for (const uf of gofoFiles) {
        try {
          const formData = new FormData()
          formData.append('file', uf.file)
          formData.append('date', selectedDate)
          if (unifiedSousTraitant) {
            formData.append('sousTraitantName', unifiedSousTraitant)
          }
          
          const { data } = await api.post('/api/tours/import', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          })
          
          results.push({
            success: true,
            file: uf.file.name,
            result: data,
            sourceType: 'gofo'
          })
        } catch (err: any) {
          const errorData = err?.response?.data
          
          // Patterns inconnus
          if (errorData?.error === 'UNKNOWN_TRACKING_PATTERNS') {
            setUnknownPatternsModal({
              show: true,
              unknownPrefixes: errorData.unknownPrefixes || [],
              expectedType: 'gofo',
              pendingAction: () => unifiedImportMutation.mutate()
            })
            const initialAssignments: Record<string, 'gofo' | 'caniao' | 'autre'> = {}
            for (const up of (errorData.unknownPrefixes || [])) {
              initialAssignments[up.prefix] = 'gofo'
            }
            setPatternAssignments(initialAssignments)
            return { results, hasUnknownPatterns: true }
          }
          
          // Chauffeur inconnu Gofo - collecter pour le modal
          if (errorData?.error === 'UNKNOWN_CHAUFFEUR') {
            gofoUnknownChauffeurs.push({
              filename: uf.file.name,
              chauffeur: errorData.chauffeur,
              similarChauffeurs: errorData.similarChauffeurs || [],
              file: uf.file
            })
          } else {
            results.push({
              success: false,
              file: uf.file.name,
              error: errorData?.message || err?.message || 'Erreur import Gofo',
              sourceType: 'gofo'
            })
          }
        }
      }
      
      // Si des chauffeurs Gofo inconnus, ouvrir le modal
      if (gofoUnknownChauffeurs.length > 0) {
        // Récupérer les chauffeurs existants
        let existingChauffeurs: any[] = []
        try {
          const { data } = await api.get('/api/chauffeurs')
          existingChauffeurs = data?.chauffeurs || []
        } catch (e) {
          console.error('Erreur récupération chauffeurs:', e)
        }
        
        setGofoMultiModal({
          show: true,
          unknownChauffeurs: gofoUnknownChauffeurs,
          knownChauffeurs: gofoKnownChauffeurs,
          sousTraitants: sousTraitants,
          existingChauffeurs: existingChauffeurs,
          pendingFiles: gofoUnknownChauffeurs.map(u => u.file)
        })
        
        // Initialiser les associations
        const initialAssoc: Record<string, any> = {}
        for (const uc of gofoUnknownChauffeurs) {
          initialAssoc[uc.chauffeur] = { type: 'new', sousTraitant: '' }
        }
        setGofoAssociations(initialAssoc)
        
        return { results, hasUnknownGofo: true, gofoUnknownChauffeurs }
      }
      
      // ===== COLLECTER LES CHAUFFEURS INCONNUS CAINIAO =====
      const caniaoUnknownChauffeurs: { file: File; unknownChauffeurs: any[]; existingChauffeurs: any[]; sousTraitants: string[] }[] = []
      
      // ===== IMPORTER LES FICHIERS CAINIAO =====
      // Séparer PDF (potentiellement multi-chauffeurs) et Excel (uni-chauffeur)
      const caniaoPdfFiles = caniaoFiles.filter(f => f.file.name.toLowerCase().endsWith('.pdf'))
      const caniaoExcelOnlyFiles: UnifiedFile[] = caniaoFiles.filter(f => !f.file.name.toLowerCase().endsWith('.pdf'))
      
      // D'abord les PDF multi-chauffeurs
      for (const uf of caniaoPdfFiles) {
        try {
          const data = await uploadTourCaniao(uf.file, selectedDate)
          results.push({
            success: true,
            file: uf.file.name,
            result: data,
            sourceType: 'caniao',
            type: 'multi',
            toursCount: data.tours?.length || 0,
            colisCount: data.totalColisImported || 0
          })
        } catch (err: any) {
          const errorData = err?.response?.data
          
          // Si NO_PLAGES, traiter comme uni-chauffeur
          if (errorData?.error === 'NO_PLAGES' || errorData?.message?.includes('plage')) {
            caniaoExcelOnlyFiles.push(uf)
          }
          // Patterns inconnus
          else if (errorData?.error === 'UNKNOWN_TRACKING_PATTERNS') {
            setUnknownPatternsModal({
              show: true,
              unknownPrefixes: errorData.unknownPrefixes || [],
              expectedType: 'caniao',
              pendingAction: () => unifiedImportMutation.mutate()
            })
            const initialAssignments: Record<string, 'gofo' | 'caniao' | 'autre'> = {}
            for (const up of (errorData.unknownPrefixes || [])) {
              initialAssignments[up.prefix] = 'caniao'
            }
            setPatternAssignments(initialAssignments)
            return { results, hasUnknownPatterns: true }
          }
          // Chauffeurs inconnus (PDF multi) - collecter pour le modal
          else if (errorData?.error === 'UNKNOWN_CHAUFFEURS') {
            caniaoUnknownChauffeurs.push({
              file: uf.file,
              unknownChauffeurs: errorData.unknownChauffeurs || [],
              existingChauffeurs: errorData.existingChauffeurs || [],
              sousTraitants: errorData.sousTraitants || sousTraitants
            })
          }
          else {
            results.push({
              success: false,
              file: uf.file.name,
              error: errorData?.message || err?.message || 'Erreur import Cainiao',
              sourceType: 'caniao'
            })
          }
        }
      }
      
      // Si des PDF Cainiao ont des chauffeurs inconnus, ouvrir le modal multi
      if (caniaoUnknownChauffeurs.length > 0) {
        // Fusionner tous les chauffeurs inconnus
        const allUnknownChauffeurs: any[] = []
        for (const pending of caniaoUnknownChauffeurs) {
          for (const uc of pending.unknownChauffeurs) {
            if (!allUnknownChauffeurs.find(c => c.chauffeur === uc.chauffeur)) {
              allUnknownChauffeurs.push(uc)
            }
          }
        }
        
        setCaniaoMultiModal({
          show: true,
          unknownChauffeurs: allUnknownChauffeurs,
          sousTraitants: caniaoUnknownChauffeurs[0]?.sousTraitants || sousTraitants,
          existingChauffeurs: caniaoUnknownChauffeurs[0]?.existingChauffeurs || [],
          pendingFile: caniaoUnknownChauffeurs[0]?.file || null,
          filename: caniaoUnknownChauffeurs[0]?.file?.name || ''
        })
        
        // Initialiser les associations
        const initialAssoc: Record<string, any> = {}
        for (const uc of allUnknownChauffeurs) {
          initialAssoc[uc.chauffeur] = { type: 'new', sousTraitant: '' }
        }
        setCaniaoAssociations(initialAssoc)
        
        return { results, hasUnknownCainiao: true }
      }
      
      // Puis les Excel/PDF uni-chauffeur
      const caniaoUniUnknown: { file: File; chauffeur: string; existingChauffeurs: string[]; similarChauffeurs: string[]; sousTraitants: string[] }[] = []
      
      for (const uf of caniaoExcelOnlyFiles) {
        try {
          const formData = new FormData()
          formData.append('file', uf.file)
          formData.append('date', selectedDate)
          if (unifiedSousTraitant) {
            formData.append('sousTraitantName', unifiedSousTraitant)
          }
          
          const { data } = await api.post('/api/tours/import/caniao-excel', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          })
          
          results.push({
            success: true,
            file: uf.file.name,
            result: data,
            sourceType: 'caniao',
            type: 'uni'
          })
        } catch (err: any) {
          const errorData = err?.response?.data
          
          // Patterns inconnus
          if (errorData?.error === 'UNKNOWN_TRACKING_PATTERNS') {
            setUnknownPatternsModal({
              show: true,
              unknownPrefixes: errorData.unknownPrefixes || [],
              expectedType: 'caniao',
              pendingAction: () => unifiedImportMutation.mutate()
            })
            const initialAssignments: Record<string, 'gofo' | 'caniao' | 'autre'> = {}
            for (const up of (errorData.unknownPrefixes || [])) {
              initialAssignments[up.prefix] = 'caniao'
            }
            setPatternAssignments(initialAssignments)
            return { results, hasUnknownPatterns: true }
          }
          
          // Chauffeur inconnu uni-chauffeur
          if (errorData?.error === 'UNKNOWN_CHAUFFEUR') {
            caniaoUniUnknown.push({
              file: uf.file,
              chauffeur: errorData.chauffeur,
              existingChauffeurs: errorData.existingChauffeurs || [],
              similarChauffeurs: errorData.similarChauffeurs || [],
              sousTraitants: errorData.sousTraitants || sousTraitants
            })
          } else {
            results.push({
              success: false,
              file: uf.file.name,
              error: errorData?.message || err?.message || 'Erreur import Cainiao',
              sourceType: 'caniao'
            })
          }
        }
      }
      
      // Si des fichiers Cainiao uni-chauffeur ont des chauffeurs inconnus
      if (caniaoUniUnknown.length > 0) {
        // Utiliser le premier pour ouvrir le modal
        const first = caniaoUniUnknown[0]
        setImportType('caniao')
        setUnknownChauffeurModal({
          show: true,
          chauffeur: first.chauffeur,
          filename: first.file.name,
          pendingFile: first.file,
          sousTraitants: first.sousTraitants,
          existingChauffeurs: first.existingChauffeurs.map((name: string) => ({ name, sousTraitant: '', normalized: name.toLowerCase() })),
          similarChauffeurs: first.similarChauffeurs
        })
        setAssociationType('new')
        setSelectedAssociation('')
        
        // Stocker les fichiers restants
        setCaniaoExcelFiles(caniaoUniUnknown.slice(1).map(u => u.file))
        
        return { results, hasUnknownCaniaoUni: true }
      }
      
      return { results }
    },
    onSuccess: (data: any) => {
      if (data?.hasUnknownPatterns || data?.hasUnknownGofo || data?.hasUnknownCainiao || data?.hasUnknownCaniaoUni || data?.hasUnknownMutualized) {
        // Un modal est ouvert, ne pas vider les fichiers
        // Mais afficher un message partiel si des fichiers ont réussi
        const successCount = (data?.results || []).filter((r: any) => r.success).length
        if (successCount > 0) {
          qc.invalidateQueries({ queryKey: ['tours'] })
          qc.invalidateQueries({ queryKey: ['stats'] })
          qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
        }
        return
      }
      
      // Vider les fichiers
      setUnifiedFiles([])
      setUnifiedSousTraitant('')
      
      qc.invalidateQueries({ queryKey: ['tours'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
      
      const results = data?.results || []
      const successResults = results.filter((r: any) => r.success)
      const failedResults = results.filter((r: any) => !r.success)
      
      // Compter par type
      const gofoSuccess = successResults.filter((r: any) => r.sourceType === 'gofo')
      const caniaoSuccess = successResults.filter((r: any) => r.sourceType === 'caniao')
      const mutualizedSuccess = successResults.filter((r: any) => r.sourceType === 'mutualized')
      
      const gofoColisCount = gofoSuccess.reduce((sum: number, r: any) => 
        sum + (r.result?.tour?.colisCount || r.result?.colisCount || 0), 0)
      const caniaoColisCount = caniaoSuccess.reduce((sum: number, r: any) => 
        sum + (r.colisCount || r.result?.tour?.colisCount || r.result?.colisCount || 0), 0)
      
      // Pour les mutualisés, compter les Gofo et Cainiao séparément
      const mutGofoCount = mutualizedSuccess.reduce((sum: number, r: any) => sum + (r.gofoCount || r.result?.gofoCount || 0), 0)
      const mutCaniaoCount = mutualizedSuccess.reduce((sum: number, r: any) => sum + (r.caniaoCount || r.result?.caniaoCount || 0), 0)
      
      let message = '✅ Import terminé:\n'
      
      // Afficher les mutualisés comme "séparés en Gofo + Cainiao"
      if (mutualizedSuccess.length > 0) {
        message += `\n🔀 ${mutualizedSuccess.length} fichier(s) mutualisé(s) séparé(s):`
        message += `\n   → 🔵 ${mutGofoCount} colis Gofo`
        message += `\n   → 🟣 ${mutCaniaoCount} colis Cainiao`
      }
      if (gofoSuccess.length > 0) {
        message += `\n🔵 ${gofoSuccess.length} tournée(s) Gofo: ${gofoColisCount} colis`
      }
      if (caniaoSuccess.length > 0) {
        message += `\n🟣 ${caniaoSuccess.length} tournée(s) Cainiao: ${caniaoColisCount} colis`
      }
      if (gofoSuccess.length === 0 && caniaoSuccess.length === 0 && mutualizedSuccess.length === 0) {
        message = '⚠️ Aucune tournée importée'
      }
      
      if (failedResults.length > 0) {
        message += `\n\n❌ ${failedResults.length} erreur(s):\n` +
          failedResults.map((r: any) => `• ${r.file}: ${r.error}`).join('\n')
      }
      
      alert(message)
    },
    onError: (err: any) => {
      alert(`Erreur: ${err?.message}`)
    }
  })

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
  
  const normalTours = (normalData?.tours || []).slice().sort((a: any, b: any) => 
    (a.chauffeurName || a.chauffeur || '').localeCompare(b.chauffeurName || b.chauffeur || '', 'fr', { sensitivity: 'base' })
  )
  
  const caniaoTours = (caniaoData?.tours || []).slice().sort((a: any, b: any) => 
    (a.chauffeurName || a.chauffeur || '').localeCompare(b.chauffeurName || b.chauffeur || '', 'fr', { sensitivity: 'base' })
  )

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
          {/* FORMULAIRE UNIFIÉ - Import avec détection automatique */}
          <div className="surface">
            <p className="card-title">📦 Import Tournées</p>
            <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
              Détection automatique Gofo 🔵 / Cainiao 🟣 - Glissez tous vos fichiers ici
            </p>
            
            <div className="input-group">
              <label>Sous-traitant (optionnel - auto-dispatch)</label>
              <select 
                value={unifiedSousTraitant} 
                onChange={(e) => setUnifiedSousTraitant(e.target.value)} 
                style={{ background: '#1a1a2e', color: '#fff' }}
              >
                <option value="" style={{ background: '#1a1a2e', color: '#fff' }}>-- Auto-dispatch --</option>
                {sousTraitants.map(st => (
                  <option key={st} value={st} style={{ background: '#1a1a2e', color: '#fff' }}>{st}</option>
                ))}
              </select>
            </div>
            
            {/* Zone de drop unifiée */}
            <div 
              className="input-group" 
              style={{ marginTop: 12 }}
              onDragOver={(e) => { e.preventDefault(); setIsUnifiedDragging(true) }}
              onDragLeave={(e) => { e.preventDefault(); setIsUnifiedDragging(false) }}
              onDrop={(e) => {
                e.preventDefault()
                setIsUnifiedDragging(false)
                const droppedFiles = Array.from(e.dataTransfer.files).filter(f => 
                  f.name.toLowerCase().endsWith('.pdf') || f.name.toLowerCase().endsWith('.xlsx')
                )
                if (droppedFiles.length > 0) {
                  addUnifiedFiles(droppedFiles)
                }
              }}
            >
              <div 
                style={{ 
                  border: isUnifiedDragging ? '2px dashed #4ade80' : '2px dashed #444', 
                  borderRadius: 8, 
                  padding: 24, 
                  textAlign: 'center', 
                  cursor: 'pointer',
                  background: isUnifiedDragging ? 'rgba(74, 222, 128, 0.1)' : 'transparent'
                }}
                onClick={() => document.getElementById('unified-file-input')?.click()}
              >
                <p style={{ margin: 0, color: '#aaa', fontSize: 14 }}>
                  {unifiedFiles.length === 0 
                    ? '📂 Glissez vos fichiers PDF/Excel ici (Gofo et Cainiao mélangés OK)' 
                    : `${unifiedFiles.length} fichier(s) - Cliquez pour en ajouter`}
                </p>
                {isDetecting && (
                  <p style={{ margin: '8px 0 0 0', color: '#f59e0b', fontSize: 12 }}>
                    ⏳ Détection du type en cours...
                  </p>
                )}
              </div>
              <input 
                id="unified-file-input" 
                type="file" 
                accept=".pdf,.xlsx" 
                multiple
                onChange={(e) => {
                  const newFiles = Array.from(e.target.files || [])
                  if (newFiles.length > 0) {
                    addUnifiedFiles(newFiles)
                  }
                  e.target.value = ''
                }} 
                style={{ display: 'none' }} 
              />
            </div>
            
            {/* Liste des fichiers avec type détecté */}
            {unifiedFiles.length > 0 && (
              <div style={{ marginTop: 12, maxHeight: 300, overflow: 'auto' }}>
                {unifiedFiles.map((uf, i) => (
                  <div 
                    key={i} 
                    style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center', 
                      padding: '10px 12px', 
                      background: 'var(--panel)', 
                      borderRadius: 6, 
                      marginBottom: 6,
                      borderLeft: uf.detectedType === 'gofo' 
                        ? '3px solid #3b82f6' 
                        : uf.detectedType === 'caniao' 
                          ? '3px solid #8b5cf6'
                          : uf.detectedType === 'mutualized'
                            ? '3px solid #10b981'
                            : uf.detectedType === 'detecting'
                              ? '3px solid #f59e0b'
                              : '3px solid #666'
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 13 }}>
                        {uf.file.name.toLowerCase().endsWith('.pdf') ? '📕' : '📗'} {uf.file.name}
                      </span>
                      {uf.isMultiChauffeur && (
                        <span style={{ marginLeft: 8, fontSize: 11, color: '#888' }}>(multi-chauffeurs)</span>
                      )}
                    </div>
                    
                    {/* Badge de type détecté ou sélecteur */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {uf.detectedType === 'detecting' ? (
                        <span style={{ fontSize: 12, color: '#f59e0b' }}>⏳ Détection...</span>
                      ) : uf.detectedType === 'unknown' ? (
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              setFileType(i, e.target.value as 'gofo' | 'caniao' | 'mutualized')
                            }
                          }}
                          style={{ 
                            padding: '4px 8px', 
                            borderRadius: 4, 
                            border: '1px solid #f59e0b',
                            background: '#1a1a2e', 
                            color: '#fff',
                            fontSize: 12
                          }}
                        >
                          <option value="" style={{ background: '#1a1a2e', color: '#fff' }}>❓ Choisir type</option>
                          <option value="gofo" style={{ background: '#1a1a2e', color: '#fff' }}>🔵 Gofo</option>
                          <option value="caniao" style={{ background: '#1a1a2e', color: '#fff' }}>🟣 Cainiao</option>
                          <option value="mutualized" style={{ background: '#1a1a2e', color: '#fff' }}>🔀 Mutualisé</option>
                        </select>
                      ) : (
                        <button
                          onClick={() => {
                            // Cycle: gofo → caniao → mutualized → gofo
                            const nextType = uf.detectedType === 'gofo' ? 'caniao' 
                              : uf.detectedType === 'caniao' ? 'mutualized' 
                              : 'gofo'
                            setFileType(i, nextType)
                          }}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 4,
                            border: 'none',
                            background: uf.detectedType === 'gofo' ? '#3b82f6' 
                              : uf.detectedType === 'caniao' ? '#8b5cf6' 
                              : '#10b981',
                            color: '#fff',
                            fontSize: 12,
                            cursor: 'pointer'
                          }}
                          title="Cliquez pour changer le type"
                        >
                          {uf.detectedType === 'gofo' ? '🔵 Gofo' 
                            : uf.detectedType === 'caniao' ? '🟣 Cainiao' 
                            : '🔀 Mutualisé'}
                          {uf.confidence > 0 && !uf.manualOverride && (
                            <span style={{ marginLeft: 4, opacity: 0.7 }}>({uf.confidence}%)</span>
                          )}
                        </button>
                      )}
                      
                      <button 
                        className="ghost-btn" 
                        onClick={() => removeUnifiedFile(i)} 
                        style={{ color: '#f87b7b', fontSize: 14, padding: '2px 6px' }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {/* Récap par type */}
            {unifiedFiles.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', gap: 16, fontSize: 13, flexWrap: 'wrap' }}>
                <span style={{ color: '#3b82f6' }}>
                  🔵 Gofo: {unifiedFiles.filter(f => f.detectedType === 'gofo').length}
                </span>
                <span style={{ color: '#8b5cf6' }}>
                  🟣 Cainiao: {unifiedFiles.filter(f => f.detectedType === 'caniao').length}
                </span>
                {unifiedFiles.filter(f => f.detectedType === 'mutualized').length > 0 && (
                  <span style={{ color: '#10b981' }}>
                    🔀 Mutualisé: {unifiedFiles.filter(f => f.detectedType === 'mutualized').length}
                  </span>
                )}
                {unifiedFiles.filter(f => f.detectedType === 'unknown').length > 0 && (
                  <span style={{ color: '#f59e0b' }}>
                    ❓ À définir: {unifiedFiles.filter(f => f.detectedType === 'unknown').length}
                  </span>
                )}
              </div>
            )}
            
            <p style={{ fontSize: 12, color: '#888', marginTop: 12 }}>
              💡 Le type est détecté automatiquement. Cliquez sur le badge pour le modifier si nécessaire.
            </p>
            
            <button 
              className="btn" 
              style={{ marginTop: 12, width: '100%' }} 
              onClick={() => unifiedImportMutation.mutate()} 
              disabled={
                unifiedImportMutation.isPending || 
                unifiedFiles.length === 0 || 
                isDetecting ||
                unifiedFiles.some(f => f.detectedType === 'unknown' || f.detectedType === 'detecting')
              }
            >
              {unifiedImportMutation.isPending 
                ? 'Import en cours...' 
                : isDetecting
                  ? 'Détection en cours...'
                  : unifiedFiles.some(f => f.detectedType === 'unknown')
                    ? '⚠️ Définissez le type des fichiers inconnus'
                    : `Importer ${unifiedFiles.length} fichier(s)`}
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
              <select value={toursSousTraitant} onChange={(e) => setToursSousTraitant(e.target.value)} style={{ background: '#1a1a2e', color: '#fff' }}>
                <option value="TOUS" style={{ background: '#1a1a2e', color: '#fff' }}>TOUS</option>
                {sousTraitants.map(st => <option key={st} value={st} style={{ background: '#1a1a2e', color: '#fff' }}>{st}</option>)}
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
                  {normalTours.map((t: any) => (
                    <tr key={t.id}>
                      <td>{t.chauffeurName || t.chauffeur}</td>
                      <td>{t.sousTraitantName || t.sousTraitant || '-'}</td>
                      <td>{t.colisCount}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn" onClick={() => downloadTour(t.id)} style={{ fontSize: 11, padding: '4px 8px' }}>📥</button>
                          <button className="ghost-btn" onClick={() => { if (window.confirm(`Supprimer ${t.chauffeurName || t.chauffeur}?`)) deleteMutation.mutate(t.id) }} style={{ fontSize: 11, padding: '4px 8px' }}>🗑️</button>
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
                  {caniaoTours.map((t: any) => (
                    <tr key={t.id}>
                      <td>{t.chauffeurName || t.chauffeur}</td>
                      <td>{t.colisCount}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn" onClick={() => downloadTour(t.id)} style={{ fontSize: 11, padding: '4px 8px' }}>📥</button>
                          <button className="ghost-btn" onClick={() => { if (window.confirm(`Supprimer ${t.chauffeurName || t.chauffeur}?`)) deleteMutation.mutate(t.id) }} style={{ fontSize: 11, padding: '4px 8px' }}>🗑️</button>
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
                    style={{ width: '100%', background: '#1a1a2e', color: '#fff', padding: '8px 12px', borderRadius: 6, border: '1px solid #444' }}
                  >
                    <option value="" style={{ background: '#1a1a2e', color: '#fff' }}>-- Choisir un chauffeur existant --</option>
                    {unknownChauffeurModal.existingChauffeurs.map(c => (
                      <option key={c.name} value={c.name} style={{ background: '#1a1a2e', color: '#fff' }}>
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
                        style={{ width: '100%', background: '#1a1a2e', color: '#fff', padding: '8px 12px', borderRadius: 6, border: '1px solid #444' }}
                      >
                        <option value="" style={{ background: '#1a1a2e', color: '#fff' }}>-- Choisir un sous-traitant --</option>
                        {(unknownChauffeurModal.sousTraitants.length > 0 
                          ? unknownChauffeurModal.sousTraitants 
                          : sousTraitants
                        ).map(st => (
                          <option key={st} value={st} style={{ background: '#1a1a2e', color: '#fff' }}>{st}</option>
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
                        style={{ width: '100%', background: '#1a1a2e', color: '#fff', padding: '8px 12px', borderRadius: 6, border: '1px solid #444' }}
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
              {[...caniaoMultiModal.unknownChauffeurs].sort((a, b) => 
                (a.chauffeur || '').localeCompare(b.chauffeur || '', 'fr', { sensitivity: 'base' })
              ).map((unknown, idx) => {
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
                        style={{ width: '100%', padding: 8, borderRadius: 6, background: '#1a1a2e', border: '1px solid #444', color: '#fff' }}
                      >
                        <option value="" style={{ background: '#1a1a2e', color: '#fff' }}>-- Sélectionner un chauffeur existant --</option>
                        {caniaoMultiModal.existingChauffeurs.map((c, cIdx) => (
                          <option key={cIdx} value={c.name} style={{ background: '#1a1a2e', color: '#fff' }}>{c.name} ({c.sousTraitant})</option>
                        ))}
                      </select>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <select
                          value={assoc.sousTraitant || ''}
                          onChange={(e) => {
                            if (e.target.value === '__CREATE_NEW__') {
                              // Activer le mode création pour ce chauffeur
                              setCaniaoAssociations(prev => ({
                                ...prev,
                                [unknown.chauffeur]: { type: 'new', sousTraitant: '', createNew: true }
                              }))
                            } else {
                              setCaniaoAssociations(prev => ({
                                ...prev,
                                [unknown.chauffeur]: { type: 'new', sousTraitant: e.target.value, createNew: false }
                              }))
                            }
                          }}
                          style={{ width: '100%', padding: 8, borderRadius: 6, background: '#1a1a2e', border: '1px solid #444', color: '#fff' }}
                        >
                          <option value="" style={{ background: '#1a1a2e', color: '#fff' }}>-- Sélectionner un sous-traitant --</option>
                          {(caniaoMultiModal.sousTraitants.length > 0 
                            ? caniaoMultiModal.sousTraitants 
                            : sousTraitants
                          ).map((st, stIdx) => (
                            <option key={stIdx} value={st} style={{ background: '#1a1a2e', color: '#fff' }}>{st}</option>
                          ))}
                          {/* Option pour créer nouveau */}
                          <option value="__CREATE_NEW__" style={{ background: '#1a1a2e', color: '#10b981' }}>+ Créer un nouveau sous-traitant</option>
                        </select>
                        
                        {/* Champ pour créer un nouveau sous-traitant */}
                        {(assoc as any).createNew && (
                          <input
                            type="text"
                            placeholder="Nom du nouveau sous-traitant"
                            value={assoc.sousTraitant || ''}
                            onChange={(e) => setCaniaoAssociations(prev => ({
                              ...prev,
                              [unknown.chauffeur]: { type: 'new', sousTraitant: e.target.value, createNew: true }
                            }))}
                            style={{ width: '100%', padding: 8, borderRadius: 6, background: '#1a1a2e', border: '1px solid #7c3aed', color: '#fff' }}
                            autoFocus
                          />
                        )}
                      </div>
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

      {/* Modal multi-chauffeurs GOFO */}
      {gofoMultiModal.show && (
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
              {gofoMultiModal.unknownChauffeurs.length} chauffeur(s) doivent être associés à un sous-traitant.
            </p>

            {/* Liste des chauffeurs à associer */}
            <div style={{ maxHeight: 400, overflow: 'auto' }}>
              {[...gofoMultiModal.unknownChauffeurs].sort((a, b) => 
                (a.chauffeur || '').localeCompare(b.chauffeur || '', 'fr', { sensitivity: 'base' })
              ).map((unknown, idx) => {
                const assoc = gofoAssociations[unknown.chauffeur] || { type: 'new', sousTraitant: '' }
                
                return (
                  <div key={idx} style={{ 
                    background: 'var(--panel)', 
                    borderRadius: 8, 
                    padding: 16, 
                    marginBottom: 12 
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontWeight: 'bold', color: '#fff' }}>🚗 {unknown.chauffeur}</span>
                      <span style={{ fontSize: 12, color: '#888' }}>Fichier: {unknown.filename}</span>
                    </div>
                    
                    {/* Suggestions si chauffeurs similaires */}
                    {unknown.similarChauffeurs && unknown.similarChauffeurs.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <span style={{ fontSize: 12, color: '#888' }}>Peut-être :</span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                          {unknown.similarChauffeurs.slice(0, 3).map((similar: any, sIdx: number) => (
                            <button
                              key={sIdx}
                              onClick={() => setGofoAssociations(prev => ({
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
                        onClick={() => setGofoAssociations(prev => ({
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
                        onClick={() => setGofoAssociations(prev => ({
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
                          const selected = gofoMultiModal.existingChauffeurs.find(c => c.name === e.target.value)
                          setGofoAssociations(prev => ({
                            ...prev,
                            [unknown.chauffeur]: { 
                              type: 'existing', 
                              sousTraitant: selected?.sousTraitant || '', 
                              existingChauffeur: e.target.value 
                            }
                          }))
                        }}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          borderRadius: 6,
                          border: '1px solid #444',
                          background: '#1a1a2e',
                          color: '#fff'
                        }}
                      >
                        <option value="" style={{ background: '#1a1a2e', color: '#fff' }}>-- Sélectionner un chauffeur existant --</option>
                        {gofoMultiModal.existingChauffeurs.map(c => (
                          <option key={c.name} value={c.name} style={{ background: '#1a1a2e', color: '#fff' }}>{c.name} ({c.sousTraitant})</option>
                        ))}
                      </select>
                    ) : (
                      <div>
                        {!assoc.createNewST ? (
                          <select
                            value={assoc.sousTraitant || ''}
                            onChange={(e) => {
                              if (e.target.value === '__CREATE_NEW__') {
                                setGofoAssociations(prev => ({
                                  ...prev,
                                  [unknown.chauffeur]: { ...assoc, createNewST: true, sousTraitant: '', newSTName: '' }
                                }))
                              } else {
                                setGofoAssociations(prev => ({
                                  ...prev,
                                  [unknown.chauffeur]: { ...assoc, sousTraitant: e.target.value }
                                }))
                              }
                            }}
                            style={{
                              width: '100%',
                              padding: '8px 12px',
                              borderRadius: 6,
                              border: '1px solid #444',
                              background: '#1a1a2e',
                              color: '#fff'
                            }}
                          >
                            <option value="" style={{ background: '#1a1a2e', color: '#fff' }}>-- Sélectionner un sous-traitant --</option>
                            {gofoMultiModal.sousTraitants.map(st => (
                              <option key={st} value={st} style={{ background: '#1a1a2e', color: '#fff' }}>{st}</option>
                            ))}
                            <option value="__CREATE_NEW__" style={{ background: '#1a1a2e', color: '#10b981' }}>+ Créer un nouveau sous-traitant</option>
                          </select>
                        ) : (
                          <div style={{ display: 'flex', gap: 8 }}>
                            <input
                              type="text"
                              placeholder="Nom du nouveau sous-traitant"
                              value={assoc.newSTName || ''}
                              onChange={(e) => setGofoAssociations(prev => ({
                                ...prev,
                                [unknown.chauffeur]: { ...assoc, newSTName: e.target.value }
                              }))}
                              style={{
                                flex: 1,
                                padding: '8px 12px',
                                borderRadius: 6,
                                border: '2px solid #7c3aed',
                                background: '#1a1a2e',
                                color: '#fff'
                              }}
                            />
                            <button
                              onClick={() => setGofoAssociations(prev => ({
                                ...prev,
                                [unknown.chauffeur]: { ...assoc, createNewST: false, newSTName: '' }
                              }))}
                              style={{
                                padding: '8px 12px',
                                borderRadius: 6,
                                border: 'none',
                                background: '#444',
                                color: '#fff',
                                cursor: 'pointer'
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Boutons d'action */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
              <button 
                className="ghost-btn"
                onClick={() => {
                  setGofoMultiModal({
                    show: false,
                    unknownChauffeurs: [],
                    knownChauffeurs: [],
                    sousTraitants: [],
                    existingChauffeurs: [],
                    pendingFiles: []
                  })
                  setGofoAssociations({})
                }}
              >
                Annuler
              </button>
              <button 
                className="btn"
                onClick={handleGofoMultiAssociation}
                disabled={gofoMultiModal.unknownChauffeurs.some(u => {
                  const assoc = gofoAssociations[u.chauffeur]
                  if (!assoc) return true
                  if (assoc.type === 'existing' && !assoc.existingChauffeur) return true
                  if (assoc.type === 'new') {
                    if (assoc.createNewST && !assoc.newSTName?.trim()) return true
                    if (!assoc.createNewST && !assoc.sousTraitant) return true
                  }
                  return false
                })}
              >
                ✓ Confirmer et importer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de patterns de tracking inconnus */}
      {unknownPatternsModal.show && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
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
            maxWidth: 550,
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)'
          }}>
            <h3 style={{ margin: '0 0 16px 0', color: '#8b5cf6' }}>
              🔍 Nouveaux préfixes de tracking détectés
            </h3>
            
            <p style={{ margin: '0 0 16px 0', color: '#888', fontSize: 14 }}>
              Des numéros de tracking avec des préfixes inconnus ont été détectés. 
              Indiquez à quel type ils appartiennent pour qu'ils soient reconnus automatiquement à l'avenir.
            </p>
            
            <div style={{ 
              background: 'var(--panel)', 
              borderRadius: 8, 
              padding: 16,
              marginBottom: 16,
              maxHeight: 300,
              overflow: 'auto'
            }}>
              {unknownPatternsModal.unknownPrefixes.map((up, idx) => (
                <div key={idx} style={{ 
                  marginBottom: idx < unknownPatternsModal.unknownPrefixes.length - 1 ? 16 : 0,
                  padding: 12,
                  background: 'var(--surface)',
                  borderRadius: 8
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div>
                      <span style={{ 
                        fontWeight: 'bold', 
                        fontSize: 16,
                        fontFamily: 'monospace',
                        background: '#8b5cf6',
                        color: '#fff',
                        padding: '4px 8px',
                        borderRadius: 4
                      }}>
                        {up.prefix}...
                      </span>
                      <span style={{ marginLeft: 8, color: '#888', fontSize: 13 }}>
                        ({up.count} colis)
                      </span>
                    </div>
                    <select
                      value={patternAssignments[up.prefix] || unknownPatternsModal.expectedType || 'caniao'}
                      onChange={(e) => setPatternAssignments(prev => ({
                        ...prev,
                        [up.prefix]: e.target.value as 'gofo' | 'caniao' | 'autre'
                      }))}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: '1px solid #444',
                        background: '#1a1a2e',
                        color: '#fff',
                        fontSize: 14
                      }}
                    >
                      <option value="gofo" style={{ background: '#1a1a2e', color: '#fff' }}>🔵 Gofo</option>
                      <option value="caniao" style={{ background: '#1a1a2e', color: '#fff' }}>🟣 Cainiao</option>
                      <option value="autre" style={{ background: '#1a1a2e', color: '#fff' }}>⚪ Autre</option>
                    </select>
                  </div>
                  <div style={{ fontSize: 12, color: '#666', fontFamily: 'monospace' }}>
                    Ex: {up.examples.slice(0, 2).map(e => e.substring(0, 20) + '...').join(', ')}
                  </div>
                </div>
              ))}
            </div>
            
            <div style={{ 
              display: 'flex', 
              gap: 12, 
              justifyContent: 'flex-end',
              paddingTop: 8,
              borderTop: '1px solid var(--border)'
            }}>
              <button
                onClick={() => {
                  setUnknownPatternsModal({
                    show: false,
                    unknownPrefixes: [],
                    expectedType: null,
                    pendingAction: null
                  })
                  setPatternAssignments({})
                }}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text)',
                  cursor: 'pointer'
                }}
              >
                ❌ Annuler
              </button>
              <button
                onClick={saveUnknownPatternsAndContinue}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#8b5cf6',
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                ✅ Enregistrer et continuer l'import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmation de type mismatch */}
      {typeMismatchModal.show && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
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
            maxWidth: 500,
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)'
          }}>
            <h3 style={{ margin: '0 0 16px 0', color: '#ef4444' }}>
              ⚠️ Mauvais type de fichier détecté
            </h3>
            
            <div style={{ 
              background: '#ef4444', 
              color: '#fff',
              padding: 16, 
              borderRadius: 8, 
              marginBottom: 16 
            }}>
              <p style={{ margin: 0, fontWeight: 'bold', fontSize: 16 }}>
                Ces colis semblent être de type {typeMismatchModal.detectedType.toUpperCase()} 
                {' '}et non {typeMismatchModal.expectedType.toUpperCase()}
              </p>
            </div>
            
            <p style={{ margin: '0 0 12px 0', color: '#888' }}>
              Sur {typeMismatchModal.totalColis} colis analysés, {typeMismatchModal.mismatchCount} ont un préfixe 
              de type <strong>{typeMismatchModal.detectedType}</strong>.
            </p>
            
            {typeMismatchModal.examples.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <p style={{ margin: '0 0 8px 0', fontSize: 13, color: '#888' }}>Exemples de trackings :</p>
                <div style={{ 
                  background: 'var(--panel)', 
                  borderRadius: 8, 
                  padding: 12,
                  fontFamily: 'monospace',
                  fontSize: 12
                }}>
                  {typeMismatchModal.examples.map((ex, idx) => (
                    <div key={idx} style={{ marginBottom: 4 }}>{ex}...</div>
                  ))}
                </div>
              </div>
            )}
            
            <p style={{ margin: '0 0 16px 0', fontSize: 14, color: '#f59e0b' }}>
              💡 Utilisez le formulaire <strong>"{typeMismatchModal.detectedType === 'gofo' ? 'Import Gofo' : 'Import Cainiao'}"</strong> à la place.
            </p>
            
            <div style={{ 
              display: 'flex', 
              gap: 12, 
              justifyContent: 'flex-end',
              paddingTop: 8,
              borderTop: '1px solid var(--border)'
            }}>
              <button
                onClick={() => {
                  setTypeMismatchModal(prev => ({ ...prev, show: false }))
                  // Vider les fichiers
                  if (typeMismatchModal.importType === 'gofo') {
                    setFiles([])
                  } else {
                    setCaniaoExcelFiles([])
                  }
                }}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#10b981',
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                ✓ OK, annuler l'import
              </button>
              <button
                onClick={() => {
                  if (typeMismatchModal.pendingAction) {
                    typeMismatchModal.pendingAction()
                  }
                }}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: '1px solid #ef4444',
                  background: 'transparent',
                  color: '#ef4444',
                  cursor: 'pointer',
                  fontSize: 12
                }}
              >
                Forcer l'import quand même
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmation des doublons */}
      {duplicateWarningModal.show && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
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
            maxWidth: 500,
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)'
          }}>
            <h3 style={{ margin: '0 0 16px 0', color: '#f59e0b' }}>⚠️ Attention - Doublons détectés</h3>
            
            {duplicateWarningModal.existingTours.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <p style={{ margin: '0 0 8px 0', fontWeight: 'bold', color: '#ef4444' }}>
                  🔄 Tournées {duplicateWarningModal.importType === 'cainiao' ? 'Cainiao' : 'Gofo'} existantes pour cette date :
                </p>
                <div style={{ 
                  background: 'var(--panel)', 
                  borderRadius: 8, 
                  padding: 12,
                  maxHeight: 150,
                  overflow: 'auto'
                }}>
                  {duplicateWarningModal.existingTours.map((name, idx) => (
                    <span key={idx} style={{ 
                      display: 'inline-block',
                      background: '#ef4444',
                      color: '#fff',
                      padding: '4px 8px',
                      borderRadius: 4,
                      margin: '2px 4px 2px 0',
                      fontSize: 13
                    }}>
                      {name}
                    </span>
                  ))}
                </div>
                <p style={{ margin: '8px 0 0 0', fontSize: 12, color: '#888' }}>
                  Ces tournées seront fusionnées (les colis en doublon seront ignorés)
                </p>
              </div>
            )}
            
            {duplicateWarningModal.duplicatesInImport.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <p style={{ margin: '0 0 8px 0', fontWeight: 'bold', color: '#f59e0b' }}>
                  📂 Chauffeurs présents plusieurs fois dans l'import :
                </p>
                <div style={{ 
                  background: 'var(--panel)', 
                  borderRadius: 8, 
                  padding: 12,
                  maxHeight: 150,
                  overflow: 'auto'
                }}>
                  {duplicateWarningModal.duplicatesInImport.map((name, idx) => (
                    <span key={idx} style={{ 
                      display: 'inline-block',
                      background: '#f59e0b',
                      color: '#000',
                      padding: '4px 8px',
                      borderRadius: 4,
                      margin: '2px 4px 2px 0',
                      fontSize: 13
                    }}>
                      {name}
                    </span>
                  ))}
                </div>
                <p style={{ margin: '8px 0 0 0', fontSize: 12, color: '#888' }}>
                  Les colis seront fusionnés sans doublons
                </p>
              </div>
            )}
            
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button 
                className="ghost-btn" 
                onClick={() => setDuplicateWarningModal({ show: false, existingTours: [], duplicatesInImport: [], importType: 'cainiao' })}
                style={{ flex: 1, padding: '12px 16px' }}
              >
                ❌ Annuler
              </button>
              <button 
                className="btn" 
                onClick={() => {
                  const importType = duplicateWarningModal.importType
                  setDuplicateWarningModal({ show: false, existingTours: [], duplicatesInImport: [], importType: 'cainiao' })
                  if (importType === 'gofo') {
                    normalMutation.mutate()
                  } else {
                    caniaoUnifiedMutation.mutate()
                  }
                }}
                style={{ flex: 1, padding: '12px 16px', background: '#22c55e' }}
              >
                ✅ Fusionner et importer
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
