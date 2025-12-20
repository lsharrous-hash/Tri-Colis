
import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { getColis } from '../lib/colisApi'
import type { Colis } from '../lib/colisApi'

export function Dashboard() {
  const today = new Date().toISOString().split('T')[0]
  const [selectedDate, setSelectedDate] = useState<string>(today)


  const { data: colis, isLoading, error } = useQuery<Colis[]>({
    queryKey: ['colis', selectedDate || 'all'],
    queryFn: () => getColis(selectedDate || undefined),
    staleTime: 10_000,
  })

  // Dédoublonnage par code ou trackingNumber
  const stats = useMemo(() => {
    if (!colis) return { total: 0, scanned: 0, remaining: 0 };
    const unique = new Map();
    for (const c of colis) {
      const key = c.code || c.trackingNumber;
      if (!key) continue;
      if (!unique.has(key)) {
        unique.set(key, c);
      } else {
        // Si déjà présent, garder le "scanned" à true si l'un des doublons l'est
        if ((c.scanned || c.scannedAt) && !(unique.get(key).scanned || unique.get(key).scannedAt)) {
          unique.set(key, c);
        }
      }
    }
    const arr = Array.from(unique.values());
    const total = arr.length;
    const scanned = arr.filter(c => c.scanned || c.scannedAt).length;
    const remaining = total - scanned;
    return { total, scanned, remaining };
  }, [colis]);

  return (
    <div className="stack">
      <div className="surface">
        <h1 className="title">Tableau de bord</h1>
        <p className="muted">{selectedDate ? `Statistiques du ${selectedDate}` : 'Statistiques globales de tous les colis'}</p>
        <div className="input-group" style={{ marginTop: 16, maxWidth: 300 }}>
          <label htmlFor="date-filter">Filtrer par date</label>
          <input
            id="date-filter"
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
          {selectedDate && (
            <button className="ghost-btn" onClick={() => setSelectedDate('')} style={{ marginTop: 8 }}>
              Afficher toutes les stats
            </button>
          )}
        </div>
      </div>

      <div className="grid two">
        <div className="surface">
          <p className="card-title">Colis importés (total)</p>
          <p className="stat-value">{isLoading ? '…' : stats.total}</p>
          <p className="stat-sub">Nombre total unique</p>
        </div>
        <div className="surface">
          <p className="card-title">Colis scannés</p>
          <p className="stat-value">{isLoading ? '…' : stats.scanned}</p>
          <p className="stat-sub">Restants: {isLoading ? '…' : stats.remaining}</p>
        </div>
      </div>

      {error && (
        <div className="surface">
          <p className="card-title">Erreur</p>
          <p className="muted">{(error as any)?.message ?? 'Impossible de récupérer les statistiques.'}</p>
        </div>
      )}
    </div>
  )
}
