import { onRequest } from 'firebase-functions/v2/https'
import { route } from './server.js'

export const echoregent = onRequest(
  {
    memory: '1GiB',
    timeoutSeconds: 60,
    cpu: 1,
    cors: true,
  },
  async (req: any, res: any) => {
    // Inject admin secret if not already set via environment
    if (!process.env.ECHOREGENT_ADMIN_SECRET) {
      process.env.ECHOREGENT_ADMIN_SECRET = 'echoregent-admin-2026'
    }
    await route(req, res)
  }
)

