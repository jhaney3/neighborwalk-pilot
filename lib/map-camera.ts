export function shouldNavigateToTerritory(currentTerritoryId: string, nextTerritoryId: string) {
  return currentTerritoryId !== nextTerritoryId;
}
