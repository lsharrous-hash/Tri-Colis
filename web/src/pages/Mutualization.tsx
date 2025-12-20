import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'

interface MutualizedDriver {
  name: string
  sousTraitant: string
  gofoCount: number
  caniaoCount: number
  totalCount: number
  hasBoth: boolean
}

interface MutualizedDriversResponse {
  success: boolean
  date: string
  sousTraitant: string | null
  drivers: MutualizedDriver[]
}

async function getMutualizedDrivers(date: string, sousTraitant?: string) {
  const { data } = await api.get<MutualizedDriversResponse>('/api/mutualized/drivers', {
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

export function Mutualization() {
  const { user } = useAuth()
  const today = new Date().toISOString().split('T')[0]
  const [selectedDate, setSelectedDate] = useState<string>(today)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mutualized-drivers', selectedDate],
    queryFn: () => getMutualizedDrivers(selectedDate),
    enabled: !!selectedDate,
  })

  const drivers = data?.drivers || []
  
  // Séparer les chauffeurs avec et sans mutualisation
  const mutualizedDrivers = drivers.filter(d => d.hasBoth)
  const gofoOnlyDrivers = drivers.filter(d => d.gofoCount > 0 && d.caniaoCount === 0)
  const caniaoOnlyDrivers = drivers.filter(d => d.caniaoCount > 0 && d.gofoCount === 0)

  const totalGofo = drivers.reduce((sum, d) => sum + d.gofoCount, 0)
  const totalCaniao = drivers.reduce((sum, d) => sum + d.caniaoCount, 0)
  const totalColis = drivers.reduce((sum, d) => sum + d.totalCount, 0)

  return (
    <div className="stack">
      <div className="surface">
        <h1 className="title">📦 Mutualisation Gofo + Cainiao</h1>
        <p className="muted">
          Téléchargez les fichiers Excel mutualisés prêts à importer dans Spoke.
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

      {/* Statistiques */}
      <div className="grid two">
        <div className="surface">
          <p className="card-title">📊 Résumé</p>
          <p className="stat-value">{drivers.length}</p>
          <p className="stat-sub">Chauffeur(s) total</p>
        </div>
        <div className="surface">
          <p className="card-title">📦 Colis</p>
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
            Importez d'abord des tournées Gofo et/ou Cainiao dans "Tournées & Import".
          </p>
        </div>
      )}

      {/* Chauffeurs mutualisés (Gofo + Cainiao) */}
      {mutualizedDrivers.length > 0 && (
        <div className="surface">
          <p className="card-title" style={{ color: '#4ade80' }}>
            ✅ Chauffeurs mutualisés ({mutualizedDrivers.length})
          </p>
          <p className="muted" style={{ marginBottom: 12 }}>
            Ces chauffeurs ont des colis Gofo ET Cainiao - téléchargez l'Excel mutualisé.
          </p>
          <table>
            <thead>
              <tr>
                <th>Chauffeur</th>
                <th>Gofo</th>
                <th>Cainiao</th>
                <th>Total</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {mutualizedDrivers.map((d) => (
                <tr key={d.name}>
                  <td>
                    <strong>{d.name}</strong>
                    <br />
                    <span className="muted" style={{ fontSize: 12 }}>{d.sousTraitant || 'Non assigné'}</span>
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
                    <button
                      className="btn"
                      onClick={() => downloadMutualizedExcel(d.name, selectedDate)}
                      style={{ fontSize: 13, padding: '8px 14px' }}
                    >
                      📥 Télécharger Excel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Chauffeurs Gofo uniquement */}
      {gofoOnlyDrivers.length > 0 && (
        <div className="surface">
          <p className="card-title" style={{ color: '#3b82f6' }}>
            🔵 Gofo uniquement ({gofoOnlyDrivers.length})
          </p>
          <p className="muted" style={{ marginBottom: 12 }}>
            Ces chauffeurs n'ont que des colis Gofo (pas de Cainiao à mutualiser).
          </p>
          <table>
            <thead>
              <tr>
                <th>Chauffeur</th>
                <th>Sous-traitant</th>
                <th>Colis Gofo</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {gofoOnlyDrivers.map((d) => (
                <tr key={d.name}>
                  <td><strong>{d.name}</strong></td>
                  <td>{d.sousTraitant || '-'}</td>
                  <td>
                    <span className="pill" style={{ background: '#2563eb' }}>
                      {d.gofoCount}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn"
                      onClick={() => downloadMutualizedExcel(d.name, selectedDate)}
                      style={{ fontSize: 13, padding: '8px 14px' }}
                    >
                      📥 Excel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Chauffeurs Cainiao uniquement */}
      {caniaoOnlyDrivers.length > 0 && (
        <div className="surface">
          <p className="card-title" style={{ color: '#8b5cf6' }}>
            🟣 Cainiao uniquement ({caniaoOnlyDrivers.length})
          </p>
          <p className="muted" style={{ marginBottom: 12 }}>
            Ces chauffeurs n'ont que des colis Cainiao (pas de Gofo à mutualiser).
          </p>
          <table>
            <thead>
              <tr>
                <th>Chauffeur</th>
                <th>Colis Cainiao</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {caniaoOnlyDrivers.map((d) => (
                <tr key={d.name}>
                  <td><strong>{d.name}</strong></td>
                  <td>
                    <span className="pill" style={{ background: '#7c3aed' }}>
                      {d.caniaoCount}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn"
                      onClick={() => downloadMutualizedExcel(d.name, selectedDate)}
                      style={{ fontSize: 13, padding: '8px 14px' }}
                    >
                      📥 Excel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Instructions */}
      <div className="surface" style={{ background: 'rgba(245, 165, 36, 0.1)', borderColor: 'rgba(245, 165, 36, 0.3)' }}>
        <p className="card-title">💡 Comment utiliser</p>
        <ol style={{ margin: '12px 0', paddingLeft: 20, color: 'var(--muted)' }}>
          <li>Téléchargez l'Excel mutualisé pour chaque chauffeur</li>
          <li>Importez-le dans <strong>Spoke</strong></li>
          <li>Optimisez la tournée dans Spoke</li>
          <li>Exportez le PDF depuis Spoke</li>
          <li>Réimportez le PDF optimisé dans l'app (section "Tournées & Import")</li>
        </ol>
      </div>
    </div>
  )
}
