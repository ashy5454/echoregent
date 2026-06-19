import { onRequest } from 'firebase-functions/v2/https'
import { route } from './server.js'

export const echoregent = onRequest(
  {
    memory: '1GiB',
    timeoutSeconds: 60,
    cpu: 1,
    cors: true
  },
  async (req: any, res: any) => {
    await route(req, res)
  }
)
