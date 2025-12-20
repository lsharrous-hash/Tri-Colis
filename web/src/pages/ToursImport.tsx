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

function downloadMutualizedExcel(driverName: string, date: string) {
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
    const url = `${api.defaults.baseURL}/api/mutualized/driver/${encodeURIComponent(driverName)}/export?date=${date}&token=${encodeURIComponent(token)}`
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

  // Fetch mutualized drivers
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mutualized-drivers', selectedDate, user?.sousTraitantName],
    queryFn: () => getMutualizedDrivers(selectedDate, user?.sousTraitantName || undefined),
    enabled: !!selectedDate,
  })

  const drivers: MutualizedDriver[] = data?.drivers || []

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
    e.target.value = '' // Reset input
  }

  const totalGofo = drivers.reduce((sum, d) => sum + d.gofoCount, 0)
  const totalCaniao = drivers.reduce((sum, d) => sum + d.caniaoCount, 0)
  const totalColis = drivers.reduce((sum, d) => sum + d.totalCount, 0)

  return (
    <div className="stack">
      <div className="surface">
        <h1 className="title">🚚 Mes Tournées</h1>
        <p className="muted">
          Téléchargez vos fichiers Excel, optimisez dans Spoke, puis réimportez.
        </p>
        
        <div className="input-group" style={{ marginTop: 16, maxWidth: 300 }}>
          <label htmlFor="date-filter">Date des tournées</label>
          <input
            id="date-filter"
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
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
          <p className="stat-sub">
            {totalGofo} Gofo + {totalCaniao} Cainiao
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="surface">
          <p className="muted">Chargement…</p>
        </div>
      )}

      {error && (
        <div className="surface">
          <p className="muted" style={{ color: '#f87b7b' }}>
            Erreur: {(error as any)?.response?.data?.message || (error as any)?.message}
          </p>
        </div>
      )}

      {!isLoading && !error && drivers.length === 0 && (
        <div className="surface">
          <p className="muted">Aucune tournée trouvée pour cette date.</p>
          <p className="muted" style={{ marginTop: 8 }}>
            Attendez que le directeur importe les fichiers Gofo et Cainiao.
          </p>
        </div>
      )}

      {/* Drivers Table */}
      {!isLoading && !error && drivers.length > 0 && (
        <div className="surface">
          <p className="card-title">📋 Vos tournées</p>
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Chauffeur</th>
                <th>Gofo</th>
                <th>Cainiao</th>
                <th>Total</th>
                <th>Statut</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.name}>
                  <td>
                    <strong>{d.name}</strong>
                  </td>
                  <td>
                    <span className="pill" style={{ background: '#2563eb' }}>
                      {d.gofoCount}
                    </span>
                  </td>
                  <td>
                    <span className="pill" style={{ background: '#7c3aed' }}>
                      {d.caniaoCount}
                    </span>
                  </td>
                  <td>
                    <strong>{d.totalCount}</strong>
                  </td>
                  <td>
                    {d.isOptimized ? (
                      <span className="pill" style={{ background: '#22c55e' }}>
                        ✅ Optimisé
                      </span>
                    ) : d.hasBoth ? (
                      <span className="pill" style={{ background: '#f59e0b' }}>
                        📦 Mutualisé
                      </span>
                    ) : d.gofoCount > 0 ? (
                      <span className="pill" style={{ background: '#3b82f6' }}>
                        Gofo
                      </span>
                    ) : (
                      <span className="pill" style={{ background: '#8b5cf6' }}>
                        Cainiao
                      </span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {/* Download button */}
                      <button
                        className="btn"
                        onClick={() => downloadMutualizedExcel(d.name, selectedDate)}
                        style={{ fontSize: 12, padding: '6px 10px' }}
                      >
                        📥 Excel
                      </button>
                      
                      {/* Upload optimized button */}
                      <label 
                        className="btn" 
                        style={{ 
                          fontSize: 12, 
                          padding: '6px 10px', 
                          cursor: 'pointer',
                          background: d.isOptimized ? '#22c55e' : '#f59e0b',
                          opacity: uploadingDriver === d.name ? 0.6 : 1
                        }}
                      >
                        {uploadingDriver === d.name ? '⏳...' : d.isOptimized ? '🔄 Remplacer' : '📤 Importer Spoke'}
                        <input
                          type="file"
                          accept=".pdf"
                          style={{ display: 'none' }}
                          onChange={(e) => handleFileUpload(d.name, e)}
                          disabled={uploadingDriver !== null}
                        />
                      </label>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Instructions */}
      <div className="surface" style={{ background: 'rgba(245, 165, 36, 0.1)', borderColor: 'rgba(245, 165, 36, 0.3)' }}>
        <p className="card-title">💡 Comment faire</p>
        <ol style={{ margin: '12px 0', paddingLeft: 20, color: 'var(--muted)' }}>
          <li><strong>Téléchargez</strong> l'Excel avec le bouton 📥</li>
          <li><strong>Importez</strong> dans Spoke et optimisez la tournée</li>
          <li><strong>Exportez</strong> le PDF depuis Spoke</li>
          <li><strong>Réimportez</strong> ici avec le bouton 📤 (remplace automatiquement)</li>
        </ol>
      </div>
    </div>
  )
}

// =====================
// ADMIN VIEW (original)
// =====================
function AdminView() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const today = new Date().toISOString().split('T')[0]

  // Import state
  const [files, setFiles] = useState<File[]>([])
  const [date, setDate] = useState<string>(today)
  const [sousTraitant, setSousTraitant] = useState<string>('')
  const [isDragging, setIsDragging] = useState(false)
  const [caniaoFile, setCaniaoFile] = useState<File | null>(null)
  const [caniaoDate, setCaniaoDate] = useState<string>(today)

  // Tours state
  const [selectedDate, setSelectedDate] = useState<string>(today)
  const [toursSousTraitant, setToursSousTraitant] = useState<string>('TOUS')

  // Sous-traitants
  const { data: sousTraitantsData } = useQuery({
    queryKey: ['sous-traitants'],
    queryFn: getSousTraitants,
  })
  const sousTraitants = sousTraitantsData?.sousTraitants || []

  // Import mutations
  const normalMutation = useMutation({
    mutationFn: async () => {
      if (files.length === 0) throw new Error('Aucun fichier sélectionné')
      if (!date) throw new Error('Date requise')
      if (!sousTraitant) throw new Error('Sous-traitant requis')
      const results = []
      for (const file of files) {
        const result = await uploadTour(file, date, sousTraitant)
        results.push(result)
      }
      return results
    },
    onSuccess: (results) => {
      setFiles([])
      setSousTraitant('')
      qc.invalidateQueries({ queryKey: ['tours'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
      const totalColis = results.reduce((sum, r) => sum + (r.tour?.colisCount || 0), 0)
      alert(`${results.length} tournée(s) importée(s) avec succès: ${totalColis} colis au total`)
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err?.message || 'Erreur inconnue'
      alert(`Erreur d'import: ${msg}`)
    },
  })

  const caniaoMutation = useMutation({
    mutationFn: () => {
      if (!caniaoFile) throw new Error('Aucun fichier CANIAO sélectionné')
      if (!caniaoDate) throw new Error('Date requise')
      return uploadTourCaniao(caniaoFile, caniaoDate)
    },
    onSuccess: (data) => {
      setCaniaoFile(null)
      qc.invalidateQueries({ queryKey: ['tours'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
      const toursCount = data.tours?.length || 0
      const count = data.tours?.reduce((sum: number, t: any) => sum + (t.colisCount || 0), 0) || 0
      alert(`Import CANIAO réussi: ${toursCount} tournée(s) créée(s), ${count} colis`)
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err?.message || 'Erreur inconnue'
      alert(`Erreur d'import CANIAO: ${msg}`)
    },
  })

  // Tours queries
  const { data: normalData, isLoading: normalLoading, error: normalError } = useQuery({
    queryKey: ['tours', 'normal', selectedDate, toursSousTraitant],
    queryFn: () =>
      getTours({
        date: selectedDate || undefined,
        sousTraitant: toursSousTraitant !== 'TOUS' ? toursSousTraitant : undefined,
        isCaniaoOnly: false,
      }),
  })
  const { data: caniaoData, isLoading: caniaoLoading, error: caniaoError } = useQuery({
    queryKey: ['tours', 'caniao', selectedDate],
    queryFn: () =>
      getTours({
        date: selectedDate || undefined,
        isCaniaoOnly: true,
      }),
  })
  const normalTours = normalData?.tours || []
  const caniaoTours = caniaoData?.tours || []

  // Delete mutations
  const deleteMutation = useMutation({
    mutationFn: (tourId: number) => deleteTour(tourId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tours'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
    },
  })

  const deleteAllNormalTours = async () => {
    if (normalTours.length === 0) {
      alert('Aucune tournée à supprimer')
      return
    }
    const totalColis = normalTours.reduce((sum, t) => sum + (t.colisCount || 0), 0)
    const confirmed = window.confirm(
      `⚠️ Supprimer TOUTES les ${normalTours.length} tournées normales (${totalColis} colis au total) ?\n\nCette action est irréversible !`
    )
    if (!confirmed) return
    let deletedCount = 0
    for (const tour of normalTours) {
      try {
        await deleteTour(tour.id)
        deletedCount++
      } catch (e) {
        console.error('Erreur suppression tournée', tour.id, e)
      }
    }
    qc.invalidateQueries({ queryKey: ['tours'] })
    qc.invalidateQueries({ queryKey: ['stats'] })
    qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
    alert(`✅ ${deletedCount} tournées supprimées`)
  }

  const deleteAllCaniaoTours = async () => {
    if (caniaoTours.length === 0) {
      alert('Aucune tournée CANIAO à supprimer')
      return
    }
    const totalColis = caniaoTours.reduce((sum, t) => sum + (t.colisCount || 0), 0)
    const confirmed = window.confirm(
      `⚠️ Supprimer TOUTES les ${caniaoTours.length} tournées CANIAO (${totalColis} colis au total) ?\n\nCette action est irréversible !`
    )
    if (!confirmed) return
    let deletedCount = 0
    for (const tour of caniaoTours) {
      try {
        await deleteTour(tour.id)
        deletedCount++
      } catch (e) {
        console.error('Erreur suppression tournée CANIAO', tour.id, e)
      }
    }
    qc.invalidateQueries({ queryKey: ['tours'] })
    qc.invalidateQueries({ queryKey: ['stats'] })
    qc.invalidateQueries({ queryKey: ['mutualized-drivers'] })
    alert(`✅ ${deletedCount} tournées CANIAO supprimées`)
  }

  // Handlers for import
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (!sousTraitant) {
      alert("Veuillez choisir le sous-traitant avant d'ajouter des fichiers.")
      return
    }
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      f => f.type === 'application/pdf' || f.name.endsWith('.pdf') || f.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || f.name.endsWith('.xlsx')
    )
    if (droppedFiles.length > 0) {
      setFiles(prev => [...prev, ...droppedFiles])
    }
  }
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!sousTraitant) {
      alert("Veuillez choisir le sous-traitant avant de sélectionner des fichiers.")
      e.target.value = ''
      return
    }
    const selectedFiles = e.target.files ? Array.from(e.target.files) : []
    if (selectedFiles.length > 0) {
      setFiles(prev => [
        ...prev,
        ...selectedFiles.filter(f =>
          f.type === 'application/pdf' || f.name.endsWith('.pdf') ||
          f.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || f.name.endsWith('.xlsx')
        )
      ])
    }
  }
  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  return (
    <div>
      <div className="surface">
        <h1 className="title">📦 Import & Tournées</h1>
        <p className="muted">Importez les fichiers Gofo (Excel) et Cainiao (PDF), puis gérez les tournées.</p>
      </div>

      <div className="toursimport-flex">
        {/* Colonne Import */}
        <div className="toursimport-col">
          {/* Import Gofo */}
          <div className="surface">
            <p className="card-title">🔵 Import Gofo (Excel)</p>
            <p className="muted" style={{ marginBottom: 12 }}>
              Fichiers Excel du directeur (1 par chauffeur).
            </p>
            <div className="grid two">
              <div className="input-group">
                <label htmlFor="normal-st">Sous-traitant *</label>
                <select
                  id="normal-st"
                  value={sousTraitant}
                  onChange={(e) => setSousTraitant(e.target.value)}
                  required
                >
                  <option value="">-- Choisir --</option>
                  {sousTraitants.map(st => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>
              <div className="input-group">
                <label htmlFor="normal-date">Date *</label>
                <input
                  id="normal-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
            </div>
            <div
              className="input-group"
              style={{ marginTop: 12 }}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <label>Fichiers Excel *</label>
              <div
                style={{
                  border: isDragging ? '2px dashed var(--accent)' : '2px dashed #444',
                  borderRadius: 8,
                  padding: 24,
                  textAlign: 'center',
                  background: isDragging ? 'rgba(123, 97, 255, 0.1)' : 'transparent',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  if (!sousTraitant) {
                    alert("Veuillez choisir le sous-traitant d'abord.")
                    return
                  }
                  document.getElementById('normal-file')?.click()
                }}
              >
                <p style={{ margin: 0, color: '#aaa' }}>
                  {files.length === 0
                    ? '📂 Glissez-déposez vos fichiers Excel ici'
                    : `${files.length} fichier(s) sélectionné(s)`}
                </p>
              </div>
              <input
                id="normal-file"
                type="file"
                accept=".xlsx,.pdf"
                multiple
                onChange={handleFileInput}
                style={{ display: 'none' }}
              />
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
              <button
                className="btn"
                onClick={() => normalMutation.mutate()}
                disabled={normalMutation.isPending || files.length === 0 || !date || !sousTraitant}
              >
                {normalMutation.isPending ? 'Import en cours...' : `Importer ${files.length || ''} fichier(s)`}
              </button>
            </div>
          </div>

          {/* Import Cainiao */}
          <div className="surface">
            <p className="card-title">🟣 Import Cainiao (PDF)</p>
            <p className="muted" style={{ marginBottom: 12 }}>
              Fichier PDF Cainiao avec tous les chauffeurs.
            </p>
            <div className="grid two">
              <div className="input-group">
                <label htmlFor="caniao-file">Fichier PDF *</label>
                <input
                  id="caniao-file"
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setCaniaoFile(e.target.files?.[0] || null)}
                  required
                />
              </div>
              <div className="input-group">
                <label htmlFor="caniao-date">Date *</label>
                <input
                  id="caniao-date"
                  type="date"
                  value={caniaoDate}
                  onChange={(e) => setCaniaoDate(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="actions" style={{ marginTop: 12 }}>
              <button
                className="btn"
                onClick={() => caniaoMutation.mutate()}
                disabled={caniaoMutation.isPending || !caniaoFile || !caniaoDate}
              >
                {caniaoMutation.isPending ? 'Import en cours...' : 'Importer Cainiao'}
              </button>
            </div>
          </div>
        </div>

        {/* Colonne Tournées */}
        <div className="toursimport-col">
          {/* Filtres */}
          <div className="surface">
            <p className="card-title">🔍 Filtres</p>
            <div className="grid two" style={{ marginTop: 8 }}>
              <div className="input-group">
                <label htmlFor="date-filter">Date</label>
                <input
                  id="date-filter"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              </div>
              <div className="input-group">
                <label htmlFor="st-filter">Sous-traitant</label>
                <select
                  id="st-filter"
                  value={toursSousTraitant}
                  onChange={(e) => setToursSousTraitant(e.target.value)}
                >
                  <option value="TOUS">TOUS</option>
                  {sousTraitants.map(st => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Tournées normales */}
          <div className="surface">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <p className="card-title" style={{ margin: 0 }}>🔵 Tournées Gofo ({normalTours.length})</p>
              {normalTours.length > 0 && (
                <button className="ghost-btn" onClick={deleteAllNormalTours} style={{ color: '#f87b7b', fontSize: 13 }}>
                  🗑️ Tout supprimer
                </button>
              )}
            </div>
            {normalLoading && <p className="muted">Chargement…</p>}
            {normalError && <p className="muted" style={{ color: '#f87b7b' }}>Erreur</p>}
            {!normalLoading && !normalError && normalTours.length === 0 && (
              <p className="muted">Aucune tournée Gofo.</p>
            )}
            {!normalLoading && !normalError && normalTours.length > 0 && (
              <table style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Chauffeur</th>
                    <th>S-T</th>
                    <th>Colis</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {normalTours.map((t) => (
                    <tr key={t.id}>
                      <td>{t.chauffeurName}</td>
                      <td>{t.sousTraitantName || '-'}</td>
                      <td>{t.colisCount}</td>
                      <td>
                        <button
                          className="ghost-btn"
                          onClick={() => {
                            if (window.confirm(`Supprimer ${t.chauffeurName}?`)) {
                              deleteMutation.mutate(t.id)
                            }
                          }}
                          style={{ fontSize: 12, padding: '4px 8px' }}
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Tournées Cainiao */}
          <div className="surface">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <p className="card-title" style={{ margin: 0 }}>🟣 Tournées Cainiao ({caniaoTours.length})</p>
              {caniaoTours.length > 0 && (
                <button className="ghost-btn" onClick={deleteAllCaniaoTours} style={{ color: '#f87b7b', fontSize: 13 }}>
                  🗑️ Tout supprimer
                </button>
              )}
            </div>
            {caniaoLoading && <p className="muted">Chargement…</p>}
            {caniaoError && <p className="muted" style={{ color: '#f87b7b' }}>Erreur</p>}
            {!caniaoLoading && !caniaoError && caniaoTours.length === 0 && (
              <p className="muted">Aucune tournée Cainiao.</p>
            )}
            {!caniaoLoading && !caniaoError && caniaoTours.length > 0 && (
              <table style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Chauffeur</th>
                    <th>Colis</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {caniaoTours.map((t) => (
                    <tr key={t.id}>
                      <td>{t.chauffeurName}</td>
                      <td>{t.colisCount}</td>
                      <td>
                        <button
                          className="ghost-btn"
                          onClick={() => {
                            if (window.confirm(`Supprimer ${t.chauffeurName}?`)) {
                              deleteMutation.mutate(t.id)
                            }
                          }}
                          style={{ fontSize: 12, padding: '4px 8px' }}
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// =====================
// MAIN COMPONENT
// =====================
export function ToursImport() {
  const { user } = useAuth()
  
  // Dispatcher voit sa vue simplifiée
  if (user?.role === 'DISPATCHER') {
    return <DispatcherView />
  }
  
  // Admin voit la vue complète
  return <AdminView />
}
