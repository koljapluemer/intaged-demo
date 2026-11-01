import { mkdir } from 'node:fs/promises'
import { createServer, type Server as HttpServer } from 'node:http'
import os from 'node:os'
import { Repo, type PeerId } from '@automerge/automerge-repo'
import { WebSocketServerAdapter } from '@automerge/automerge-repo-network-websocket'
import { NodeFSStorageAdapter } from '@automerge/automerge-repo-storage-nodefs'
import { WebSocketServer } from 'ws'

export async function startSyncServer(directory: string, port: number) {
  await mkdir(directory, { recursive: true })
  const socketServer = new WebSocketServer({ noServer: true })
  const repo = new Repo({
    network: [
      new WebSocketServerAdapter(
        socketServer as unknown as ConstructorParameters<typeof WebSocketServerAdapter>[0],
        60_000,
      ),
    ],
    storage: new NodeFSStorageAdapter(directory),
    peerId: `storage-server-${os.hostname()}` as PeerId,
    sharePolicy: async () => false,
  })
  const server: HttpServer = createServer((request, response) => {
    response.writeHead(request.url === '/' ? 200 : 404, { 'Content-Type': 'text/plain' })
    response.end(request.url === '/' ? 'theadoc sync is running' : 'Not found')
  })
  server.on('upgrade', (request, socket, head) => {
    socketServer.handleUpgrade(request, socket, head, (client) => {
      socketServer.emit('connection', client, request)
    })
  })
  await new Promise<void>((resolve) => server.listen(port, '0.0.0.0', resolve))
  return {
    repo,
    close: async () => {
      socketServer.close()
      await repo.shutdown()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    },
  }
}
