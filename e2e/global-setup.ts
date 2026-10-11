import { PLAY_SERVER, TEST_SERVER, startServer, stopServer } from './servers'

// Servers are slow to boot (XMage loads every card), so they are shared by all tests.
// Set E2E_KEEP_SERVERS=1 to leave them running between runs while developing.
export default async function globalSetup() {
  await Promise.all([startServer(TEST_SERVER), startServer(PLAY_SERVER)])
  return async () => {
    if (process.env.E2E_KEEP_SERVERS === '1') return
    stopServer(TEST_SERVER)
    stopServer(PLAY_SERVER)
  }
}
