// ⚠️ Cette page est obsolète. Utilisez la page fusionnée ToursImport.tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteTour, downloadTour, getTours, getSousTraitants } from '../lib/api'
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export function Tours() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const today = new Date().toISOString().split('T')[0]
  const [selectedDate, setSelectedDate] = useState<string>(today)
  const [sousTraitant, setSousTraitant] = useState<string>('TOUS')

  const { data: sousTraitantsData } = useQuery({
    queryKey: ['sous-traitants'],
    queryFn: getSousTraitants,
  })

  const sousTraitants = sousTraitantsData?.sousTraitants || []

  // Tournées normales (non-CANIAO)
  const { data: normalData, isLoading: normalLoading, error: normalError } = useQuery({
    queryKey: ['tours', 'normal', selectedDate, sousTraitant],
    queryFn: () =>
      getTours({
        date: selectedDate || undefined,
        sousTraitant: sousTraitant !== 'TOUS' ? sousTraitant : undefined,
        isCaniaoOnly: false,
      }),
  })

  // Tournées CANIAO
  const { data: caniaoData, isLoading: caniaoLoading, error: caniaoError } = useQuery({
    queryKey: ['tours', 'caniao', selectedDate],
    queryFn: () =>
      getTours({
        date: selectedDate || undefined,
        isCaniaoOnly: true,
      }),
  })

  const deleteMutation = useMutation({
    mutationFn: (tourId: number) => deleteTour(tourId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tours'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })

  const normalTours = normalData?.tours || []
  const caniaoTours = caniaoData?.tours || []

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
    alert(`✅ ${deletedCount} tournées CANIAO supprimées`)
  }

  return (
    <div className="stack">
      <div className="surface">
        <h1 className="title">Tournées</h1>
        <p className="muted">Gestion des tournées normales et CANIAO</p>

        <div className="grid two" style={{ marginTop: 16 }}>
          <div className="input-group">
            <label htmlFor="date-filter">Filtrer par date</label>
            <input
              id="date-filter"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>

          {user?.role === 'ADMIN' && (
            <div className="input-group">
              <label htmlFor="st-filter">Sous-traitant (tournées normales)</label>
              <select
                id="st-filter"
                value={sousTraitant}
                onChange={(e) => setSousTraitant(e.target.value)}
              >
                <option value="TOUS">TOUS</option>
                {sousTraitants.map(st => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </div>
          )}

          {(selectedDate || sousTraitant !== 'TOUS') && (
            <div className="actions">
              <button
                className="ghost-btn"
                onClick={() => {
                  setSelectedDate('')
                  setSousTraitant('TOUS')
                }}
              >
                Réinitialiser les filtres
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tournées normales */}
      <div className="surface">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p className="card-title" style={{ margin: 0 }}>Tournées normales ({normalTours.length})</p>
          {normalTours.length > 0 && (
            <button
              className="ghost-btn"
              onClick={deleteAllNormalTours}
              style={{ color: '#f87b7b', fontSize: 13 }}
            >
              🗑️ Tout supprimer
            </button>
          )}
        </div>
        {normalLoading && <p className="muted">Chargement…</p>}
        {normalError && (
          <p className="muted" style={{ color: '#f87b7b' }}>
            Erreur: {(normalError as any)?.response?.data?.message || (normalError as any)?.message}
          </p>
        )}
        {!normalLoading && !normalError && normalTours.length === 0 && (
          <p className="muted">Aucune tournée normale trouvée.</p>
        )}
        {!normalLoading && !normalError && normalTours.length > 0 && (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Chauffeur</th>
                <th>Sous-traitant</th>
                <th>Colis</th>
                <th>Type</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {normalTours.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>{t.chauffeurName}</td>
                  <td>{t.sousTraitantName || '-'}</td>
                  <td>{t.colisCount}</td>
                  <td>
                    {t.isDispatcherImport ? (
                      <span className="pill" style={{ background: '#3e4d2d' }}>
                        Dispatcher
                      </span>
                    ) : (
                      <span className="pill">Normal</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn"
                        onClick={() => downloadTour(t.id)}
                        style={{ fontSize: 13, padding: '6px 12px' }}
                      >
                        📥 Excel
                      </button>
                      <button
                        className="ghost-btn"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Supprimer la tournée "${t.tourneeName || t.chauffeurName}" (${t.colisCount} colis) ?`
                            )
                          ) {
                            deleteMutation.mutate(t.id)
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        style={{ fontSize: 13, padding: '6px 12px' }}
                      >
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Tournées CANIAO */}
      <div className="surface">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p className="card-title" style={{ margin: 0 }}>Tournées CANIAO ({caniaoTours.length})</p>
          {caniaoTours.length > 0 && (
            <button
              className="ghost-btn"
              onClick={deleteAllCaniaoTours}
              style={{ color: '#f87b7b', fontSize: 13 }}
            >
              🗑️ Tout supprimer
            </button>
          )}
        </div>
        {caniaoLoading && <p className="muted">Chargement…</p>}
        {caniaoError && (
          <p className="muted" style={{ color: '#f87b7b' }}>
            Erreur: {(caniaoError as any)?.response?.data?.message || (caniaoError as any)?.message}
          </p>
        )}
        {!caniaoLoading && !caniaoError && caniaoTours.length === 0 && (
          <p className="muted">Aucune tournée CANIAO trouvée.</p>
        )}
        {!caniaoLoading && !caniaoError && caniaoTours.length > 0 && (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Chauffeur</th>
                <th>Sous-traitant</th>
                <th>Colis</th>
                <th>Type</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {caniaoTours.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>{t.chauffeurName}</td>
                  <td>{t.sousTraitantName || '-'}</td>
                  <td>{t.colisCount}</td>
                  <td>
                    <span className="pill" style={{ background: '#7b61ff' }}>
                      CANIAO
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn"
                        onClick={() => downloadTour(t.id)}
                        style={{ fontSize: 13, padding: '6px 12px' }}
                      >
                        📥 Excel
                      </button>
                      {/* Suppression individuelle désactivée pour l'admin */}
                    </div>
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
