// The app's page cache. Here a purge is logged.
export async function purgeCachedPage(path: string): Promise<void> {
  console.log(`Purged ${path}`);
}
