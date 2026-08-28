// The shared Automerge repo. One per tab: a WebSocket connection to our sync
// server plus an IndexedDB cache so a reload rejoins instantly and offline
// edits catch up later.

import { Repo, type Repo as RepoType } from '@automerge/automerge-repo';
import { WebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { PUBLIC_SYNC_URL } from '$env/static/public';

let repo: RepoType | undefined;

export function getRepo(): RepoType {
	if (!repo) {
		repo = new Repo({
			network: [new WebSocketClientAdapter(PUBLIC_SYNC_URL)],
			storage: new IndexedDBStorageAdapter('clabber')
		});
	}
	return repo;
}

/** The sync server's HTTP origin (for the join-code registry). */
export const SYNC_HTTP = PUBLIC_SYNC_URL.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '');
