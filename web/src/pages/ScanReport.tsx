import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'

interface ScanReportData {
  success: boolean
  date: string
  sousTraitant: string | null
  summary: {
    totalUnique: number
    scanned: number
    unscanned: number
    progressPercent: number
  }
  scannerStats: Record<string, number>
  scannedColis: Array<{
    trackingNumber: string
    address: string
    chauffeur: string
    lastScannedBy: string
    lastScannedAt: string
    tourType: string
  }>
  unscannedColis: Array<{
    trackingNumber: string
    address: string
    chauffeur: string
    sousTraitant: string
    tourType: string
  }>
}

async function getScanReport(date: string, sousTraitant?: string): Promise<ScanReportData> {
  const { data } = await api.get('/api/stats/scan-report', {
    params: { date, sousTraitant }
  })
  return data
}

export function ScanReport() {
  const { user } = useAuth()
  const today = new Date().toISOString().split('T')[0]
  const [selectedDate, setSelectedDate] = useState<string>(today)
  const [activeTab, setActiveTab] = useState<'unscanned' | 'scanned'>('unscanned')
  const [searchTerm, setSearchTerm] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['scan-report', selectedDate, user?.sousTraitantName],
    queryFn: () => getScanReport(selectedDate, user?.role === 'DISPATCHER' ? user.sousTraitantName : undefined),
    enabled: !!selectedDate,
    refetchInterval: 30000, // Rafraîchir toutes les 30 secondes
  })

  // Filtrer par recherche
  const filteredUnscanned = data?.unscannedColis?.filter(c => 
    c.trackingNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.chauffeur.toLowerCase().includes(searchTerm.toLowerCase())
  ) || []

  const filteredScanned = data?.scannedColis?.filter(c => 
    c.trackingNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.chauffeur.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.lastScannedBy.toLowerCase().includes(searchTerm.toLowerCase())
  ) || []

  // Formater la date/heure
  const formatDateTime = (isoString: string) => {
    if (!isoString) return '-'
    const date = new Date(isoString)
    return date.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div className="stack">
      <div className="surface">
        <h1 className="title">📊 Rapport de Tri</h1>
        <p className="muted">Suivi des colis scannés et non scannés</p>
        
        <div className="input-group" style={{ marginTop: 16, maxWidth: 300 }}>
          <label htmlFor="date-filter">Date</label>
          <input
            id="date-filter"
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </div>
      </div>

      {isLoading && (
        <div className="surface">
          <p className="muted">Chargement...</p>
        </div>
      )}

      {error && (
        <div className="surface">
          <p className="muted" style={{ color: '#f87b7b' }}>
            Erreur: {(error as any)?.response?.data?.message || (error as any)?.message}
          </p>
        </div>
      )}

      {data && (
        <>
          {/* Stats principales */}
          <div className="grid two">
            <div className="surface" style={{ textAlign: 'center' }}>
              <p className="card-title">📦 Colis uniques</p>
              <p className="stat-value">{data.summary.totalUnique}</p>
              <p className="stat-sub">à trier aujourd'hui</p>
            </div>
            <div className="surface" style={{ textAlign: 'center' }}>
              <p className="card-title">📈 Progression</p>
              <p className="stat-value" style={{ color: data.summary.progressPercent === 100 ? '#22c55e' : '#f59e0b' }}>
                {data.summary.progressPercent}%
              </p>
              <p className="stat-sub">{data.summary.scanned} scannés / {data.summary.unscanned} restants</p>
            </div>
          </div>

          {/* Barre de progression */}
          <div className="surface">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: '#22c55e' }}>✅ Scannés: {data.summary.scanned}</span>
              <span style={{ color: '#f87b7b' }}>❌ Non scannés: {data.summary.unscanned}</span>
            </div>
            <div style={{ 
              width: '100%', 
              height: 20, 
              background: '#333', 
              borderRadius: 10, 
              overflow: 'hidden' 
            }}>
              <div style={{ 
                width: `${data.summary.progressPercent}%`, 
                height: '100%', 
                background: data.summary.progressPercent === 100 ? '#22c55e' : '#f59e0b',
                transition: 'width 0.3s ease'
              }} />
            </div>
          </div>

          {/* Stats par scanneur */}
          {Object.keys(data.scannerStats).length > 0 && (
            <div className="surface">
              <p className="card-title">👥 Colis scannés par trieur</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
                {Object.entries(data.scannerStats)
                  .sort(([,a], [,b]) => b - a)
                  .map(([scanner, count]) => (
                    <div key={scanner} style={{ 
                      background: 'var(--panel)', 
                      padding: '8px 16px', 
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8
                    }}>
                      <span style={{ fontWeight: 600 }}>{scanner}</span>
                      <span className="pill" style={{ background: '#22c55e' }}>{count}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          )}

          {/* Onglets */}
          <div className="surface">
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button
                className={activeTab === 'unscanned' ? 'btn' : 'ghost-btn'}
                onClick={() => setActiveTab('unscanned')}
                style={{ 
                  background: activeTab === 'unscanned' ? '#f87b7b' : undefined,
                  flex: 1
                }}
              >
                ❌ Non scannés ({data.summary.unscanned})
              </button>
              <button
                className={activeTab === 'scanned' ? 'btn' : 'ghost-btn'}
                onClick={() => setActiveTab('scanned')}
                style={{ 
                  background: activeTab === 'scanned' ? '#22c55e' : undefined,
                  flex: 1
                }}
              >
                ✅ Scannés ({data.summary.scanned})
              </button>
            </div>

            {/* Recherche */}
            <div className="input-group" style={{ marginBottom: 16 }}>
              <input
                type="text"
                placeholder="🔍 Rechercher par tracking, adresse, chauffeur..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            {/* Tableau des colis non scannés */}
            {activeTab === 'unscanned' && (
              <>
                {filteredUnscanned.length === 0 ? (
                  <p className="muted" style={{ textAlign: 'center', padding: 24 }}>
                    {data.summary.unscanned === 0 
                      ? '🎉 Tous les colis ont été scannés !' 
                      : 'Aucun résultat pour cette recherche'}
                  </p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Tracking</th>
                          <th>Adresse</th>
                          <th>Chauffeur</th>
                          <th>Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUnscanned.map((c, i) => (
                          <tr key={c.trackingNumber}>
                            <td>{i + 1}</td>
                            <td>
                              <code style={{ fontSize: 12, background: '#333', padding: '2px 6px', borderRadius: 4 }}>
                                {c.trackingNumber}
                              </code>
                            </td>
                            <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {c.address || '-'}
                            </td>
                            <td>{c.chauffeur}</td>
                            <td>
                              <span className="pill" style={{ 
                                background: c.tourType === 'Cainiao' ? '#7c3aed' : '#2563eb',
                                fontSize: 11
                              }}>
                                {c.tourType}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* Tableau des colis scannés */}
            {activeTab === 'scanned' && (
              <>
                {filteredScanned.length === 0 ? (
                  <p className="muted" style={{ textAlign: 'center', padding: 24 }}>
                    {data.summary.scanned === 0 
                      ? 'Aucun colis scanné pour le moment' 
                      : 'Aucun résultat pour cette recherche'}
                  </p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Tracking</th>
                          <th>Adresse</th>
                          <th>Chauffeur</th>
                          <th>Scanné par</th>
                          <th>Date/Heure</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredScanned.map((c, i) => (
                          <tr key={c.trackingNumber}>
                            <td>{i + 1}</td>
                            <td>
                              <code style={{ fontSize: 12, background: '#333', padding: '2px 6px', borderRadius: 4 }}>
                                {c.trackingNumber}
                              </code>
                            </td>
                            <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {c.address || '-'}
                            </td>
                            <td>{c.chauffeur}</td>
                            <td>
                              <span style={{ fontWeight: 600, color: '#22c55e' }}>
                                {c.lastScannedBy}
                              </span>
                            </td>
                            <td style={{ fontSize: 12, color: '#aaa' }}>
                              {formatDateTime(c.lastScannedAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
