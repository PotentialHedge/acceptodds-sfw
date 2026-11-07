/** Runs once as the server starts (Next.js). Not in `next build`, nor in the tests. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.WARM_EXAMPLE_SEARCHES === '0') return;
  const { startExampleWarmer } = await import('./server/example-warmer');
  startExampleWarmer();
}
