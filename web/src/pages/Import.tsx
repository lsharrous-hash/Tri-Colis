// ⚠️ Cette page est obsolète. Utilisez la page fusionnée ToursImport.tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { uploadTour, uploadTourCaniao, getSousTraitants } from '../lib/api'
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export function Import() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const today = new Date().toISOString().split('T')[0]
  const [files, setFiles] = useState<File[]>([])
  const [date, setDate] = useState<string>(today)
  const [sousTraitant, setSousTraitant] = useState<string>('')
  const [isDragging, setIsDragging] = useState(false)
  const [caniaoFile, setCaniaoFile] = useState<File | null>(null)
  const [caniaoDate, setCaniaoDate] = useState<string>(today)

  const { data: sousTraitantsData } = useQuery({
    queryKey: ['sous-traitants'],
    queryFn: getSousTraitants,
  })

  const sousTraitants = sousTraitantsData?.sousTraitants || []

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
      const totalColis = results.reduce((sum, r) => sum + (r.tour?.colisCount || 0), 0)
      alert(`${results.length} tournée(s) importée(s) avec succès: ${totalColis} colis au total`)
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err?.message || 'Erreur inconnue'
      alert(`Erreur d'import: ${msg}`)
    },
  })

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
    if (user?.role === 'ADMIN' && !sousTraitant) {
      alert("Veuillez choisir le sous-traitant avant d'ajouter des fichiers.")
      return
    }
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      f => f.type === 'application/pdf' || f.name.endsWith('.pdf')
    )
    if (droppedFiles.length > 0) {
      setFiles(prev => [...prev, ...droppedFiles])
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (user?.role === 'ADMIN' && !sousTraitant) {
      alert("Veuillez choisir le sous-traitant avant de sélectionner des fichiers.")
      e.target.value = ''
      return
    }
    const selectedFiles = e.target.files ? Array.from(e.target.files) : []
    if (selectedFiles.length > 0) {
      setFiles(prev => [...prev, ...selectedFiles])
    }
  }

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

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
      const count = data.totalColis || 0
      const toursCount = data.toursCreated || 0
      alert(`Import CANIAO réussi: ${toursCount} tournée(s) créée(s), ${count} colis`)
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err?.message || 'Erreur inconnue'
      alert(`Erreur d'import CANIAO: ${msg}`)
    },
  })

  return (
    <div className="stack">
      <div className="surface">
        <h1 className="title">Import de tournées</h1>
        <p className="muted">Importer des fichiers PDF Spoke ou CANIAO pour créer des tournées.</p>
      </div>

      <div className="surface">
        <p className="card-title">Tournée normale (Spoke)</p>
        <p className="muted" style={{ marginBottom: 12 }}>
          Fichier PDF Spoke contenant une seule tournée (chauffeur + colis).
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
          <label htmlFor="normal-file">Fichiers PDF * (plusieurs fichiers acceptés)</label>
          <div
            style={{
              border: isDragging ? '2px dashed var(--accent)' : '2px dashed #444',
              borderRadius: 8,
              padding: 24,
              textAlign: 'center',
              background: isDragging ? 'rgba(123, 97, 255, 0.1)' : 'transparent',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onClick={() => {
              if (user?.role === 'ADMIN' && !sousTraitant) {
                alert("Veuillez choisir le sous-traitant avant de sélectionner des fichiers.")
                return
              }
              document.getElementById('normal-file')?.click()
            }}
          >
            <p style={{ margin: 0, color: '#aaa' }}>
              {files.length === 0
                ? '📁 Glissez-déposez vos fichiers PDF ici ou cliquez pour sélectionner'
                : `${files.length} fichier(s) sélectionné(s)`}
            </p>
          </div>
          <input
            id="normal-file"
            type="file"
            accept=".pdf"
            multiple
            onChange={handleFileInput}
            style={{ display: 'none' }}
          />
          {files.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {files.map((f, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    background: 'var(--panel)',
                    borderRadius: 6,
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontSize: 13 }}>📄 {f.name}</span>
                  <button
                    className="ghost-btn"
                    onClick={() => removeFile(i)}
                    style={{ fontSize: 12, padding: '4px 8px', color: '#f87b7b' }}
                  >
                    ✕
                  </button>
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
            {normalMutation.isPending ? `Import en cours (${files.length} fichier${files.length > 1 ? 's' : ''})...` : `Importer ${files.length || ''} tournée${files.length > 1 ? 's' : ''}`}
          </button>
        </div>
      </div>

      <div className="surface">
        <p className="card-title">Tournées CANIAO (multi-chauffeurs)</p>
        <p className="muted" style={{ marginBottom: 12 }}>
          Fichier PDF CANIAO contenant plusieurs chauffeurs avec plages de numéros.
        </p>
        <div className="grid two">
          <div className="input-group">
            <label htmlFor="caniao-file">Fichier PDF CANIAO *</label>
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
            {caniaoMutation.isPending ? 'Import CANIAO en cours…' : 'Importer CANIAO'}
          </button>
        </div>
      </div>
    </div>
  )
}
