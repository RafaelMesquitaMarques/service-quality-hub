// Listes de repli pour les occurrences.
// Depuis 2026-07, la source de vérité est en base (tables `departments` et
// `categories`, gérées via Référentiels) — voir hooks/useTaxonomy.js.
// Ces constantes ne servent que si la table est vide ou inaccessible.

export const CATEGORIES = [
  'Damaged', 'Cleaning', 'Electrical', 'Fitting/Adjustment', 'Hardware',
  'Metal', 'Missing Component', 'Missing Unit', 'Scratches', 'Stone',
  'Upholstery', 'Wood', 'Packaging', 'Bad production',
]

export const DEPARTMENTS = [
  'Production', 'Int. Sales', 'Ext. Sales', 'Purchasing', 'Supplier', 'Product Dev.',
  'Engineering', 'Client', 'Vietnam', 'Install', 'Planning', 'NCW',
  'Shipping', 'VC', 'Project Mgnt', 'EOI',
]
