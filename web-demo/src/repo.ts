import { Repo } from '@automerge/automerge-repo'
import { BroadcastChannelNetworkAdapter } from '@automerge/automerge-repo-network-broadcastchannel'
import { WebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb'

const syncUrl = import.meta.env.VITE_SYNC_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`

export const repo = new Repo({
  storage: new IndexedDBStorageAdapter(),
  network: [new BroadcastChannelNetworkAdapter(), new WebSocketClientAdapter(syncUrl)],
})
