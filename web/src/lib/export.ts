// Utilitaires pour exporter des données en CSV

export function downloadCSV(data: any[], filename: string, columns: { key: string; label: string }[]) {
  // Créer l'en-tête
  const header = columns.map(col => col.label).join(',')
  
  // Créer les lignes
  const rows = data.map(item => {
    return columns.map(col => {
      const value = item[col.key]
      // Échapper les virgules et guillemets
      if (value == null) return ''
      const str = String(value)
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }).join(',')
  })
  
  // Combiner header + rows
  const csv = [header, ...rows].join('\n')
  
  // Créer un blob et télécharger
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  
  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
