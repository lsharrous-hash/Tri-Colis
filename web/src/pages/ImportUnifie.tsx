import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useCallback } from 'react'
import { 
  importUnified, 
  getChauffeursSummary, 
  downloadExport, 
  getSousTraitants,
  addSousTraitant,
  getExistingChauffeurs,
  ImportUnifiedResponse,
  UnknownChauffeur,
  ChauffeurSummary,
  ExistingChauffeur,
  api
} from '../lib/api'

// =====================
// Types
// =====================
interface PendingFile {
  file: File
  status: 'pending' | 'importing' | 'success' | 'error' | 'needs_assignment'
  result?: ImportUnifiedResponse
  error?: string
}

// =====================
// Main Component
// =====================
export function ImportUnifie() {
  const qc = useQueryClient()
  const today = new Date().toISOString().split('T')[0]
  
  // State
  const [files, setFiles] = useState<PendingFile[]>([])
  const [date, setDate] = useState<string>(today)
  const [isDragging, setIsDragging] = useState(false)
  
  // Modal state pour chauffeurs inconnus
  const [showModal, setShowModal] = useState(false)
  const [allUnknownChauffeurs, setAllUnknownChauffeurs] = useState<UnknownChauffeur[]>([])
  const [availableST, setAvailableST] = useState<string[]>([])
  const [existingChauffeurs, setExistingChauffeurs] = useState<ExistingChauffeur[]>([])
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [assignmentModes, setAssignmentModes] = useState<Record<string, 'existing' | 'newST' | 'createST'>>({})
  const [existingChauffeurAssignments, setExistingChauffeurAssignments] = useState<Record<string, string>>({})
  const [newSTNames, setNewSTNames] = useState<Record<string, string>>({})
  const [pendingFilesForAssignment, setPendingFilesForAssignment] = useState<File[]>([])
  const [newSTName, setNewSTName] = useState('')
  
  // Progress
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 })
  
  // Résultats globaux
  const [importSummary, setImportSummary] = useState<{
    success: number
    failed: number
    totalColis: number
    gofoCount: number
    caniaoCount: number
    duplicates: number
  } | null>(null)
  
  // Query pour les sous-traitants
  const { data: stData } = useQuery({
    queryKey: ['sous-traitants'],
    queryFn: getSousTraitants,
  })
  
  // Query pour les chauffeurs existants
  const { data: existingData, refetch: refetchExisting } = useQuery({
    queryKey: ['existing-chauffeurs'],
    queryFn: getExistingChauffeurs,
    enabled: false, // On fetch manuellement quand on en a besoin
  })
  
  // Query pour le résumé par date
  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['chauffeurs-summary', date],
    queryFn: () => getChauffeursSummary(date),
    enabled: !!date,
  })
  
  // Mutation pour ajouter un sous-traitant
  const addSTMutation = useMutation({
    mutationFn: addSousTraitant,
    onSuccess: (data) => {
      setAvailableST(data.sousTraitants || [])
      setNewSTName('')
      qc.invalidateQueries({ queryKey: ['sous-traitants'] })
    },
  })
  
  // Mutation pour supprimer les colis d'un chauffeur
  const deleteChauffeurMutation = useMutation({
    mutationFn: async ({ chauffeur, date }: { chauffeur: string; date: string }) => {
      const { data } = await api.delete(`/api/chauffeurs/${encodeURIComponent(chauffeur)}/colis`, {
        params: { date }
      })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chauffeurs-summary'] })
      qc.invalidateQueries({ queryKey: ['tours'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err?.message || 'Erreur de suppression'
      alert(`Erreur: ${msg}`)
    },
  })
  
  // Handler suppression chauffeur
  const handleDeleteChauffeur = (chauffeur: string) => {
    if (confirm(`Supprimer tous les colis de ${chauffeur} pour le ${date} ?`)) {
      deleteChauffeurMutation.mutate({ chauffeur, date })
    }
  }
  
  // Handlers drag & drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])
  
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])
  
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFiles = Array.from(e.dataTransfer.files).filter(f => 
      f.name.endsWith('.pdf') || f.name.endsWith('.xlsx') || f.name.endsWith('.xls')
    )
    if (droppedFiles.length > 0) {
      setFiles(prev => [
        ...prev, 
        ...droppedFiles.map(f => ({ file: f, status: 'pending' as const }))
      ])
      setImportSummary(null)
    } else {
      alert('Format non supporté. Utilisez PDF ou Excel (.xlsx)')
    }
  }, [])
  
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files ? Array.from(e.target.files) : []
    if (selectedFiles.length > 0) {
      setFiles(prev => [
        ...prev, 
        ...selectedFiles.map(f => ({ file: f, status: 'pending' as const }))
      ])
      setImportSummary(null)
    }
    // Reset input
    e.target.value = ''
  }, [])
  
  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }
  
  const clearAllFiles = () => {
    setFiles([])
    setImportSummary(null)
  }
  
  // Fonction d'import d'un fichier
  const importSingleFile = async (
    file: File, 
    fileAssignments?: Record<string, string>
  ): Promise<ImportUnifiedResponse> => {
    return importUnified(file, date, fileAssignments)
  }
  
  // Handler import principal
  const handleImport = async () => {
    if (files.length === 0 || !date) return
    
    setIsImporting(true)
    setImportProgress({ current: 0, total: files.length })
    
    const allUnknown: UnknownChauffeur[] = []
    const filesNeedingAssignment: File[] = []
    let successCount = 0
    let failCount = 0
    let totalColis = 0
    let gofoTotal = 0
    let caniaoTotal = 0
    let duplicatesTotal = 0
    
    // Première passe: importer ce qu'on peut
    for (let i = 0; i < files.length; i++) {
      const pf = files[i]
      setImportProgress({ current: i + 1, total: files.length })
      
      // Mettre à jour le statut
      setFiles(prev => prev.map((f, idx) => 
        idx === i ? { ...f, status: 'importing' } : f
      ))
      
      try {
        const result = await importSingleFile(pf.file, assignments)
        
        if (result.error === 'UNKNOWN_CHAUFFEURS') {
          // Collecter les chauffeurs inconnus
          const unknown = result.unknownChauffeurs || []
          unknown.forEach(u => {
            if (!allUnknown.find(a => a.name.toLowerCase() === u.name.toLowerCase())) {
              allUnknown.push(u)
            }
          })
          filesNeedingAssignment.push(pf.file)
          
          setFiles(prev => prev.map((f, idx) => 
            idx === i ? { ...f, status: 'needs_assignment', result } : f
          ))
          
          // Mettre à jour les ST disponibles
          if (result.sousTraitants) {
            setAvailableST(result.sousTraitants)
          }
        } else if (result.success) {
          successCount++
          totalColis += result.totalImported || 0
          gofoTotal += result.gofoCount || 0
          caniaoTotal += result.caniaoCount || 0
          duplicatesTotal += result.totalDuplicates || 0
          
          setFiles(prev => prev.map((f, idx) => 
            idx === i ? { ...f, status: 'success', result } : f
          ))
        }
      } catch (err: any) {
        // Vérifier si c'est une erreur UNKNOWN_CHAUFFEURS (status 400)
        const errorData = err?.response?.data
        console.log('[IMPORT] Catch error:', errorData?.error, 'data:', errorData)
        
        if (errorData?.error === 'UNKNOWN_CHAUFFEURS') {
          console.log('[IMPORT] Chauffeurs inconnus:', errorData.unknownChauffeurs)
          // Collecter les chauffeurs inconnus
          const unknown = errorData.unknownChauffeurs || []
          unknown.forEach((u: UnknownChauffeur) => {
            if (!allUnknown.find(a => a.name.toLowerCase() === u.name.toLowerCase())) {
              allUnknown.push(u)
            }
          })
          filesNeedingAssignment.push(pf.file)
          
          setFiles(prev => prev.map((f, idx) => 
            idx === i ? { ...f, status: 'needs_assignment', result: errorData } : f
          ))
          
          // Mettre à jour les ST disponibles
          if (errorData.sousTraitants) {
            setAvailableST(errorData.sousTraitants)
          }
        } else {
          failCount++
          const errorMsg = errorData?.message || err?.message || 'Erreur inconnue'
          setFiles(prev => prev.map((f, idx) => 
            idx === i ? { ...f, status: 'error', error: errorMsg } : f
          ))
        }
      }
    }
    
    setIsImporting(false)
    
    console.log('[IMPORT] Fin import. allUnknown:', allUnknown.length, 'filesNeedingAssignment:', filesNeedingAssignment.length)
    
    // S'il y a des chauffeurs inconnus, afficher le modal
    if (allUnknown.length > 0) {
      console.log('[IMPORT] Chauffeurs inconnus détectés, ouverture du modal...')
      setAllUnknownChauffeurs(allUnknown)
      setPendingFilesForAssignment(filesNeedingAssignment)
      
      // Récupérer les chauffeurs existants
      try {
        const existing = await getExistingChauffeurs()
        setExistingChauffeurs(existing.chauffeurs || [])
        setAvailableST(existing.sousTraitants || [])
      } catch (e) {
        console.error('Erreur chargement chauffeurs existants:', e)
      }
      
      // Initialiser les modes et assignments
      const initialModes: Record<string, 'existing' | 'newST' | 'createST'> = {}
      const initialAssignments: Record<string, string> = {}
      const initialExisting: Record<string, string> = {}
      const initialNewST: Record<string, string> = {}
      
      allUnknown.forEach(c => {
        initialModes[c.name] = 'newST'  // Par défaut: nouveau chauffeur avec ST existant
        initialAssignments[c.name] = ''
        initialExisting[c.name] = ''
        initialNewST[c.name] = ''
      })
      
      setAssignmentModes(initialModes)
      setAssignments(initialAssignments)
      setExistingChauffeurAssignments(initialExisting)
      setNewSTNames(initialNewST)
      console.log('[IMPORT] Ouverture du modal avec', allUnknown.length, 'chauffeurs inconnus')
      setShowModal(true)
    } else {
      // Afficher le résumé final
      setImportSummary({
        success: successCount,
        failed: failCount,
        totalColis,
        gofoCount: gofoTotal,
        caniaoCount: caniaoTotal,
        duplicates: duplicatesTotal
      })
      
      // Rafraîchir les données
      qc.invalidateQueries({ queryKey: ['chauffeurs-summary'] })
      qc.invalidateQueries({ queryKey: ['tours'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    }
  }
  
  // Handler réimport avec assignments
  const handleReimportWithAssignments = async () => {
    // Construire les assignments finaux selon les modes
    const finalAssignments: Record<string, string> = {}
    
    for (const ch of allUnknownChauffeurs) {
      const mode = assignmentModes[ch.name]
      
      if (mode === 'existing') {
        // Associer à un chauffeur existant → utiliser son ST
        const existingName = existingChauffeurAssignments[ch.name]
        const existing = existingChauffeurs.find(e => e.name === existingName)
        if (!existing) {
          alert(`Veuillez sélectionner un chauffeur existant pour "${ch.name}"`)
          return
        }
        finalAssignments[ch.name] = existing.sousTraitant
      } else if (mode === 'newST') {
        // Nouveau chauffeur avec ST existant
        const st = assignments[ch.name]
        if (!st || st.trim() === '') {
          alert(`Veuillez sélectionner un sous-traitant pour "${ch.name}"`)
          return
        }
        finalAssignments[ch.name] = st
      } else if (mode === 'createST') {
        // Nouveau chauffeur avec nouveau ST
        const newST = newSTNames[ch.name]
        if (!newST || newST.trim().length < 2) {
          alert(`Veuillez entrer un nom de sous-traitant pour "${ch.name}" (min 2 caractères)`)
          return
        }
        // Ajouter le nouveau ST s'il n'existe pas
        if (!availableST.includes(newST.trim())) {
          try {
            await addSousTraitant(newST.trim())
            setAvailableST(prev => [...prev, newST.trim()])
          } catch (e) {
            console.error('Erreur ajout ST:', e)
          }
        }
        finalAssignments[ch.name] = newST.trim()
      }
    }
    
    setShowModal(false)
    setIsImporting(true)
    setImportProgress({ current: 0, total: pendingFilesForAssignment.length })
    
    let successCount = files.filter(f => f.status === 'success').length
    let failCount = files.filter(f => f.status === 'error').length
    let totalColis = files.filter(f => f.status === 'success').reduce((sum, f) => sum + (f.result?.totalImported || 0), 0)
    let gofoTotal = files.filter(f => f.status === 'success').reduce((sum, f) => sum + (f.result?.gofoCount || 0), 0)
    let caniaoTotal = files.filter(f => f.status === 'success').reduce((sum, f) => sum + (f.result?.caniaoCount || 0), 0)
    let duplicatesTotal = files.filter(f => f.status === 'success').reduce((sum, f) => sum + (f.result?.totalDuplicates || 0), 0)
    
    // Réimporter les fichiers en attente avec les assignments
    for (let i = 0; i < pendingFilesForAssignment.length; i++) {
      const file = pendingFilesForAssignment[i]
      setImportProgress({ current: i + 1, total: pendingFilesForAssignment.length })
      
      // Trouver l'index dans files
      const fileIndex = files.findIndex(f => f.file === file)
      if (fileIndex >= 0) {
        setFiles(prev => prev.map((f, idx) => 
          idx === fileIndex ? { ...f, status: 'importing' } : f
        ))
      }
      
      try {
        const result = await importSingleFile(file, finalAssignments)
        
        if (result.success) {
          successCount++
          totalColis += result.totalImported || 0
          gofoTotal += result.gofoCount || 0
          caniaoTotal += result.caniaoCount || 0
          duplicatesTotal += result.totalDuplicates || 0
          
          if (fileIndex >= 0) {
            setFiles(prev => prev.map((f, idx) => 
              idx === fileIndex ? { ...f, status: 'success', result } : f
            ))
          }
        } else {
          failCount++
          if (fileIndex >= 0) {
            setFiles(prev => prev.map((f, idx) => 
              idx === fileIndex ? { ...f, status: 'error', error: result.message || 'Erreur' } : f
            ))
          }
        }
      } catch (err: any) {
        failCount++
        const errorMsg = err?.response?.data?.message || err?.message || 'Erreur'
        if (fileIndex >= 0) {
          setFiles(prev => prev.map((f, idx) => 
            idx === fileIndex ? { ...f, status: 'error', error: errorMsg } : f
          ))
        }
      }
    }
    
    setIsImporting(false)
    setPendingFilesForAssignment([])
    setAllUnknownChauffeurs([])
    
    // Afficher le résumé final
    setImportSummary({
      success: successCount,
      failed: failCount,
      totalColis,
      gofoCount: gofoTotal,
      caniaoCount: caniaoTotal,
      duplicates: duplicatesTotal
    })
    
    // Rafraîchir les données
    qc.invalidateQueries({ queryKey: ['chauffeurs-summary'] })
    qc.invalidateQueries({ queryKey: ['tours'] })
    qc.invalidateQueries({ queryKey: ['stats'] })
  }
  
  // Déterminer l'icône du fichier
  const getFileIcon = (filename: string) => {
    if (filename.endsWith('.pdf')) return '📄'
    if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) return '📊'
    return '📁'
  }
  
  // Icône de statut
  const getStatusIcon = (status: PendingFile['status']) => {
    switch (status) {
      case 'pending': return '⏳'
      case 'importing': return '🔄'
      case 'success': return '✅'
      case 'error': return '❌'
      case 'needs_assignment': return '👤'
      default: return '📁'
    }
  }
  
  const getStatusColor = (status: PendingFile['status']) => {
    switch (status) {
      case 'pending': return '#888'
      case 'importing': return '#3b82f6'
      case 'success': return '#22c55e'
      case 'error': return '#ef4444'
      case 'needs_assignment': return '#f59e0b'
      default: return '#888'
    }
  }

  return (
    <div className="stack">
      {/* Header */}
      <div className="surface">
        <h1 className="title">Import Unifié</h1>
        <p className="muted">
          Importez vos fichiers PDF (Spoke) ou Excel (Gofo/Cainiao). 
          Le système détecte automatiquement le format et sépare les colis.
        </p>
      </div>
      
      {/* Formulaire d'import */}
      <div className="surface">
        <p className="card-title">📥 Importer des fichiers</p>
        
        <div className="grid two" style={{ marginTop: 16 }}>
          <div className="input-group">
            <label htmlFor="import-date">Date de la tournée *</label>
            <input
              id="import-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="input-group">
            <label>Format supporté</label>
            <p style={{ margin: 0, fontSize: 13, color: '#888' }}>
              PDF Spoke (multi/uni), Excel Gofo, Excel Cainiao
            </p>
          </div>
        </div>
        
        {/* Zone de drop */}
        <div
          className="input-group"
          style={{ marginTop: 16 }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <label>Fichiers * (plusieurs fichiers acceptés)</label>
          <div
            style={{
              border: isDragging ? '2px dashed #7c3aed' : '2px dashed #444',
              borderRadius: 12,
              padding: 32,
              textAlign: 'center',
              background: isDragging ? 'rgba(124, 58, 237, 0.1)' : 'var(--panel)',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onClick={() => document.getElementById('file-input')?.click()}
          >
            <p style={{ margin: 0, fontSize: 32 }}>📁</p>
            <p style={{ margin: '8px 0 0 0', color: '#aaa' }}>
              Glissez-déposez vos fichiers ici
            </p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#666' }}>
              ou cliquez pour sélectionner (PDF, XLSX)
            </p>
          </div>
          <input
            id="file-input"
            type="file"
            accept=".pdf,.xlsx,.xls"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
        </div>
        
        {/* Liste des fichiers */}
        {files.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontWeight: 'bold', fontSize: 14 }}>
                {files.length} fichier{files.length > 1 ? 's' : ''} sélectionné{files.length > 1 ? 's' : ''}
              </span>
              <button
                className="ghost-btn"
                onClick={clearAllFiles}
                style={{ fontSize: 12, color: '#ef4444' }}
                disabled={isImporting}
              >
                Tout supprimer
              </button>
            </div>
            
            <div style={{ 
              maxHeight: 300, 
              overflowY: 'auto', 
              background: 'var(--panel)', 
              borderRadius: 8,
              padding: 8
            }}>
              {files.map((pf, index) => (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    background: 'var(--surface)',
                    borderRadius: 6,
                    marginBottom: 6,
                    border: `1px solid ${getStatusColor(pf.status)}22`
                  }}
                >
                  <span style={{ fontSize: 20 }}>{getFileIcon(pf.file.name)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {pf.file.name}
                    </p>
                    <p style={{ margin: 0, fontSize: 11, color: '#888' }}>
                      {(pf.file.size / 1024).toFixed(1)} Ko
                      {pf.status === 'success' && pf.result && (
                        <span style={{ color: '#22c55e', marginLeft: 8 }}>
                          • {pf.result.totalImported} colis importés
                        </span>
                      )}
                      {pf.status === 'error' && pf.error && (
                        <span style={{ color: '#ef4444', marginLeft: 8 }}>
                          • {pf.error}
                        </span>
                      )}
                      {pf.status === 'needs_assignment' && (
                        <span style={{ color: '#f59e0b', marginLeft: 8 }}>
                          • Chauffeurs à assigner
                        </span>
                      )}
                    </p>
                  </div>
                  <span style={{ fontSize: 18 }}>{getStatusIcon(pf.status)}</span>
                  {pf.status === 'pending' && !isImporting && (
                    <button
                      className="ghost-btn"
                      onClick={() => removeFile(index)}
                      style={{ padding: '4px 8px', color: '#ef4444' }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Bouton import */}
        <div className="actions" style={{ marginTop: 16 }}>
          <button
            className="btn"
            onClick={handleImport}
            disabled={isImporting || files.length === 0 || !date || files.every(f => f.status === 'success')}
            style={{ 
              padding: '14px 28px',
              fontSize: 15,
              background: isImporting ? '#666' : '#7c3aed'
            }}
          >
            {isImporting 
              ? `⏳ Import en cours... (${importProgress.current}/${importProgress.total})`
              : `🚀 Importer ${files.filter(f => f.status === 'pending' || f.status === 'needs_assignment').length} fichier${files.filter(f => f.status === 'pending').length > 1 ? 's' : ''}`
            }
          </button>
        </div>
        
        {/* Résumé d'import */}
        {importSummary && (
          <div style={{
            marginTop: 16,
            padding: 16,
            background: importSummary.failed === 0 ? 'rgba(34, 197, 94, 0.1)' : 'rgba(245, 158, 11, 0.1)',
            border: `1px solid ${importSummary.failed === 0 ? '#22c55e' : '#f59e0b'}`,
            borderRadius: 8,
          }}>
            <p style={{ margin: 0, fontWeight: 'bold', color: importSummary.failed === 0 ? '#22c55e' : '#f59e0b' }}>
              {importSummary.failed === 0 
                ? `✅ Import terminé avec succès !`
                : `⚠️ Import terminé avec ${importSummary.failed} erreur(s)`
              }
            </p>
            <div style={{ display: 'flex', gap: 24, marginTop: 8, fontSize: 14, flexWrap: 'wrap' }}>
              <span>📁 Fichiers: {importSummary.success}/{importSummary.success + importSummary.failed}</span>
              <span>📦 Colis: {importSummary.totalColis}</span>
              {importSummary.gofoCount > 0 && (
                <span style={{ color: '#f59e0b' }}>🟡 Gofo: {importSummary.gofoCount}</span>
              )}
              {importSummary.caniaoCount > 0 && (
                <span style={{ color: '#3b82f6' }}>🔵 Cainiao: {importSummary.caniaoCount}</span>
              )}
              {importSummary.duplicates > 0 && (
                <span style={{ color: '#888' }}>🔄 Doublons: {importSummary.duplicates}</span>
              )}
            </div>
          </div>
        )}
      </div>
      
      {/* Vue mutualisée - 3 tableaux */}
      <div className="surface">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p className="card-title">📊 Vue par chauffeur - {date}</p>
          {summaryData?.totals && (
            <div style={{ display: 'flex', gap: 16, fontSize: 14 }}>
              <span style={{ color: '#f59e0b' }}>🟡 Gofo: {summaryData.totals.gofo}</span>
              <span style={{ color: '#3b82f6' }}>🔵 Cainiao: {summaryData.totals.cainiao}</span>
              <span style={{ fontWeight: 'bold' }}>Total: {summaryData.totals.total}</span>
            </div>
          )}
        </div>
        
        {summaryLoading ? (
          <p style={{ textAlign: 'center', padding: 32, color: '#888' }}>Chargement...</p>
        ) : summaryData?.chauffeurs && summaryData.chauffeurs.length > 0 ? (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 24 }}>
            
            {/* Tableau 1: Mutualisé (Gofo + Cainiao) */}
            {(() => {
              const mutualized = summaryData.chauffeurs.filter((ch: ChauffeurSummary) => ch.gofo.count > 0 && ch.cainiao.count > 0)
              if (mutualized.length === 0) return null
              return (
                <div style={{ background: 'rgba(34, 197, 94, 0.05)', borderRadius: 12, padding: 16, border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                  <p style={{ margin: '0 0 12px 0', fontWeight: 'bold', color: '#22c55e', fontSize: 16 }}>
                    🟢 Mutualisé - Gofo + Cainiao ({mutualized.length})
                  </p>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #333' }}>
                        <th style={{ textAlign: 'left', padding: '10px 8px', color: '#888' }}>Chauffeur</th>
                        <th style={{ textAlign: 'left', padding: '10px 8px', color: '#888' }}>S-T</th>
                        <th style={{ textAlign: 'center', padding: '10px 8px', color: '#f59e0b' }}>Gofo</th>
                        <th style={{ textAlign: 'center', padding: '10px 8px', color: '#3b82f6' }}>Cainiao</th>
                        <th style={{ textAlign: 'center', padding: '10px 8px' }}>Total</th>
                        <th style={{ textAlign: 'center', padding: '10px 8px', color: '#888' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mutualized.map((ch: ChauffeurSummary) => (
                        <tr key={ch.chauffeur} style={{ borderBottom: '1px solid #333' }}>
                          <td style={{ padding: '10px 8px', fontWeight: 'bold' }}>{ch.chauffeur}</td>
                          <td style={{ padding: '10px 8px', color: '#888' }}>{ch.sousTraitant || '-'}</td>
                          <td style={{ textAlign: 'center', padding: '10px 8px' }}>
                            <span style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b', padding: '4px 10px', borderRadius: 12, fontWeight: 'bold' }}>{ch.gofo.count}</span>
                          </td>
                          <td style={{ textAlign: 'center', padding: '10px 8px' }}>
                            <span style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6', padding: '4px 10px', borderRadius: 12, fontWeight: 'bold' }}>{ch.cainiao.count}</span>
                          </td>
                          <td style={{ textAlign: 'center', padding: '10px 8px', fontWeight: 'bold' }}>{ch.total}</td>
                          <td style={{ textAlign: 'center', padding: '10px 8px' }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                              <button className="btn" onClick={() => downloadExport(ch.chauffeur, date, 'mutualise')} style={{ fontSize: 11, padding: '4px 10px', background: '#22c55e' }}>📥 Mutualisé</button>
                              <button className="ghost-btn" onClick={() => downloadExport(ch.chauffeur, date, 'gofo')} style={{ fontSize: 11, padding: '4px 8px', color: '#f59e0b' }}>Gofo</button>
                              <button className="ghost-btn" onClick={() => downloadExport(ch.chauffeur, date, 'cainiao')} style={{ fontSize: 11, padding: '4px 8px', color: '#3b82f6' }}>Cainiao</button>
                              <button className="ghost-btn" onClick={() => handleDeleteChauffeur(ch.chauffeur)} disabled={deleteChauffeurMutation.isPending} style={{ fontSize: 14, padding: '4px 8px', color: '#ef4444' }}>🗑️</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()}
            
            {/* Tableau 2: Gofo uniquement */}
            {(() => {
              const gofoOnly = summaryData.chauffeurs.filter((ch: ChauffeurSummary) => ch.gofo.count > 0 && ch.cainiao.count === 0)
              if (gofoOnly.length === 0) return null
              return (
                <div style={{ background: 'rgba(245, 158, 11, 0.05)', borderRadius: 12, padding: 16, border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                  <p style={{ margin: '0 0 12px 0', fontWeight: 'bold', color: '#f59e0b', fontSize: 16 }}>
                    🟡 Gofo uniquement ({gofoOnly.length})
                  </p>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #333' }}>
                        <th style={{ textAlign: 'left', padding: '10px 8px', color: '#888' }}>Chauffeur</th>
                        <th style={{ textAlign: 'left', padding: '10px 8px', color: '#888' }}>S-T</th>
                        <th style={{ textAlign: 'center', padding: '10px 8px', color: '#f59e0b' }}>Gofo</th>
                        <th style={{ textAlign: 'center', padding: '10px 8px', color: '#888' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gofoOnly.map((ch: ChauffeurSummary) => (
                        <tr key={ch.chauffeur} style={{ borderBottom: '1px solid #333' }}>
                          <td style={{ padding: '10px 8px', fontWeight: 'bold' }}>{ch.chauffeur}</td>
                          <td style={{ padding: '10px 8px', color: '#888' }}>{ch.sousTraitant || '-'}</td>
                          <td style={{ textAlign: 'center', padding: '10px 8px' }}>
                            <span style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b', padding: '4px 10px', borderRadius: 12, fontWeight: 'bold' }}>{ch.gofo.count}</span>
                          </td>
                          <td style={{ textAlign: 'center', padding: '10px 8px' }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                              <button className="btn" onClick={() => downloadExport(ch.chauffeur, date, 'gofo')} style={{ fontSize: 11, padding: '4px 10px', background: '#f59e0b' }}>📥 Export</button>
                              <button className="ghost-btn" onClick={() => handleDeleteChauffeur(ch.chauffeur)} disabled={deleteChauffeurMutation.isPending} style={{ fontSize: 14, padding: '4px 8px', color: '#ef4444' }}>🗑️</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()}
            
            {/* Tableau 3: Cainiao uniquement */}
            {(() => {
              const caniaoOnly = summaryData.chauffeurs.filter((ch: ChauffeurSummary) => ch.cainiao.count > 0 && ch.gofo.count === 0)
              if (caniaoOnly.length === 0) return null
              return (
                <div style={{ background: 'rgba(59, 130, 246, 0.05)', borderRadius: 12, padding: 16, border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                  <p style={{ margin: '0 0 12px 0', fontWeight: 'bold', color: '#3b82f6', fontSize: 16 }}>
                    🔵 Cainiao uniquement ({caniaoOnly.length})
                  </p>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #333' }}>
                        <th style={{ textAlign: 'left', padding: '10px 8px', color: '#888' }}>Chauffeur</th>
                        <th style={{ textAlign: 'left', padding: '10px 8px', color: '#888' }}>S-T</th>
                        <th style={{ textAlign: 'center', padding: '10px 8px', color: '#3b82f6' }}>Cainiao</th>
                        <th style={{ textAlign: 'center', padding: '10px 8px', color: '#888' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {caniaoOnly.map((ch: ChauffeurSummary) => (
                        <tr key={ch.chauffeur} style={{ borderBottom: '1px solid #333' }}>
                          <td style={{ padding: '10px 8px', fontWeight: 'bold' }}>{ch.chauffeur}</td>
                          <td style={{ padding: '10px 8px', color: '#888' }}>{ch.sousTraitant || '-'}</td>
                          <td style={{ textAlign: 'center', padding: '10px 8px' }}>
                            <span style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6', padding: '4px 10px', borderRadius: 12, fontWeight: 'bold' }}>{ch.cainiao.count}</span>
                          </td>
                          <td style={{ textAlign: 'center', padding: '10px 8px' }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                              <button className="btn" onClick={() => downloadExport(ch.chauffeur, date, 'cainiao')} style={{ fontSize: 11, padding: '4px 10px', background: '#3b82f6' }}>📥 Export</button>
                              <button className="ghost-btn" onClick={() => handleDeleteChauffeur(ch.chauffeur)} disabled={deleteChauffeurMutation.isPending} style={{ fontSize: 14, padding: '4px 8px', color: '#ef4444' }}>🗑️</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()}
            
          </div>
        ) : (
          <p style={{ textAlign: 'center', padding: 32, color: '#888' }}>
            Aucune donnée pour cette date. Importez un fichier ci-dessus.
          </p>
        )}
      </div>
      
      {/* Modal chauffeurs inconnus */}
      {showModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: 'var(--surface)',
            borderRadius: 16,
            padding: 24,
            width: '95%',
            maxWidth: 800,
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          }}>
            <h2 style={{ margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
              👤 Chauffeurs inconnus ({allUnknownChauffeurs.length})
            </h2>
            <p style={{ margin: '0 0 20px 0', color: '#888' }}>
              Ces chauffeurs ne sont pas reconnus. Pour chaque chauffeur, choisissez une option:
            </p>
            
            {/* Liste des chauffeurs à assigner */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 }}>
              {allUnknownChauffeurs.map((ch) => (
                <div 
                  key={ch.name}
                  style={{
                    padding: 16,
                    background: 'var(--panel)',
                    borderRadius: 12,
                    border: '1px solid #333',
                  }}
                >
                  {/* Header du chauffeur */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 'bold', fontSize: 16 }}>🚚 {ch.name}</p>
                      <p style={{ margin: 0, fontSize: 12, color: '#888' }}>
                        {ch.colisCount} colis
                        {ch.stats.gofo > 0 && <span style={{ color: '#f59e0b' }}> • {ch.stats.gofo} Gofo</span>}
                        {ch.stats.cainiao > 0 && <span style={{ color: '#3b82f6' }}> • {ch.stats.cainiao} Cainiao</span>}
                      </p>
                    </div>
                  </div>
                  
                  {/* Options d'assignation */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    
                    {/* Option 1: Associer à un chauffeur existant */}
                    <label style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 12,
                      padding: 10,
                      background: assignmentModes[ch.name] === 'existing' ? 'rgba(124, 58, 237, 0.15)' : 'var(--background)',
                      borderRadius: 8,
                      cursor: 'pointer',
                      border: assignmentModes[ch.name] === 'existing' ? '1px solid #7c3aed' : '1px solid transparent',
                    }}>
                      <input
                        type="radio"
                        name={`mode-${ch.name}`}
                        checked={assignmentModes[ch.name] === 'existing'}
                        onChange={() => setAssignmentModes(prev => ({ ...prev, [ch.name]: 'existing' }))}
                      />
                      <span style={{ flex: '0 0 200px', fontWeight: 500 }}>🔗 Associer à un existant</span>
                      <select
                        value={existingChauffeurAssignments[ch.name] || ''}
                        onChange={(e) => {
                          setExistingChauffeurAssignments(prev => ({ ...prev, [ch.name]: e.target.value }))
                          setAssignmentModes(prev => ({ ...prev, [ch.name]: 'existing' }))
                        }}
                        disabled={assignmentModes[ch.name] !== 'existing'}
                        style={{
                          flex: 1,
                          padding: '6px 10px',
                          borderRadius: 6,
                          border: '1px solid #444',
                          background: '#1a1a2e',
                          color: '#fff',
                          opacity: assignmentModes[ch.name] === 'existing' ? 1 : 0.5,
                        }}
                      >
                        <option value="" style={{ background: '#1a1a2e', color: '#fff' }}>-- Sélectionner un chauffeur --</option>
                        {existingChauffeurs.map(ec => (
                          <option key={ec.name} value={ec.name} style={{ background: '#1a1a2e', color: '#fff' }}>
                            {ec.name} ({ec.sousTraitant})
                          </option>
                        ))}
                      </select>
                    </label>
                    
                    {/* Option 2: Nouveau chauffeur avec ST existant */}
                    <label style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 12,
                      padding: 10,
                      background: assignmentModes[ch.name] === 'newST' ? 'rgba(34, 197, 94, 0.15)' : 'var(--background)',
                      borderRadius: 8,
                      cursor: 'pointer',
                      border: assignmentModes[ch.name] === 'newST' ? '1px solid #22c55e' : '1px solid transparent',
                    }}>
                      <input
                        type="radio"
                        name={`mode-${ch.name}`}
                        checked={assignmentModes[ch.name] === 'newST'}
                        onChange={() => setAssignmentModes(prev => ({ ...prev, [ch.name]: 'newST' }))}
                      />
                      <span style={{ flex: '0 0 200px', fontWeight: 500 }}>➕ Nouveau avec ST existant</span>
                      <select
                        value={assignments[ch.name] || ''}
                        onChange={(e) => {
                          setAssignments(prev => ({ ...prev, [ch.name]: e.target.value }))
                          setAssignmentModes(prev => ({ ...prev, [ch.name]: 'newST' }))
                        }}
                        disabled={assignmentModes[ch.name] !== 'newST'}
                        style={{
                          flex: 1,
                          padding: '6px 10px',
                          borderRadius: 6,
                          border: '1px solid #444',
                          background: '#1a1a2e',
                          color: '#fff',
                          opacity: assignmentModes[ch.name] === 'newST' ? 1 : 0.5,
                        }}
                      >
                        <option value="" style={{ background: '#1a1a2e', color: '#fff' }}>-- Sélectionner un sous-traitant --</option>
                        {availableST.map(st => (
                          <option key={st} value={st} style={{ background: '#1a1a2e', color: '#fff' }}>{st}</option>
                        ))}
                      </select>
                    </label>
                    
                    {/* Option 3: Créer un nouveau ST */}
                    <label style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 12,
                      padding: 10,
                      background: assignmentModes[ch.name] === 'createST' ? 'rgba(245, 158, 11, 0.15)' : 'var(--background)',
                      borderRadius: 8,
                      cursor: 'pointer',
                      border: assignmentModes[ch.name] === 'createST' ? '1px solid #f59e0b' : '1px solid transparent',
                    }}>
                      <input
                        type="radio"
                        name={`mode-${ch.name}`}
                        checked={assignmentModes[ch.name] === 'createST'}
                        onChange={() => setAssignmentModes(prev => ({ ...prev, [ch.name]: 'createST' }))}
                      />
                      <span style={{ flex: '0 0 200px', fontWeight: 500 }}>🆕 Créer un nouveau ST</span>
                      <input
                        type="text"
                        placeholder="Nom du nouveau sous-traitant"
                        value={newSTNames[ch.name] || ''}
                        onChange={(e) => {
                          setNewSTNames(prev => ({ ...prev, [ch.name]: e.target.value }))
                          setAssignmentModes(prev => ({ ...prev, [ch.name]: 'createST' }))
                        }}
                        disabled={assignmentModes[ch.name] !== 'createST'}
                        style={{
                          flex: 1,
                          padding: '6px 10px',
                          borderRadius: 6,
                          border: '1px solid #444',
                          background: '#1a1a2e',
                          color: '#fff',
                          opacity: assignmentModes[ch.name] === 'createST' ? 1 : 0.5,
                        }}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
            
            {/* Boutons */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                className="ghost-btn"
                onClick={() => {
                  setShowModal(false)
                  setPendingFilesForAssignment([])
                  setAllUnknownChauffeurs([])
                }}
                style={{ padding: '12px 24px' }}
              >
                Annuler
              </button>
              <button
                className="btn"
                onClick={handleReimportWithAssignments}
                disabled={isImporting}
                style={{ padding: '12px 24px', background: '#22c55e' }}
              >
                {isImporting ? '⏳ Import...' : `✅ Valider et importer (${pendingFilesForAssignment.length} fichiers)`}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Progress bar flottante */}
      {isImporting && (
        <div style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          background: 'var(--surface)',
          borderRadius: 12,
          padding: 16,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          zIndex: 999,
          minWidth: 250
        }}>
          <p style={{ margin: 0, fontWeight: 'bold', marginBottom: 8 }}>
            Import en cours: {importProgress.current}/{importProgress.total}
          </p>
          <div style={{
            width: '100%',
            height: 6,
            background: '#333',
            borderRadius: 3,
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${(importProgress.current / importProgress.total) * 100}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #7c3aed, #3b82f6)',
              transition: 'width 0.3s'
            }} />
          </div>
        </div>
      )}
    </div>
  )
}
