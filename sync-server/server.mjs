// Clabber sync server.
//
// A dumb Automerge relay: it forwards sync messages between the players'
// browsers and keeps a durable copy of every document on disk so a game
// survives everyone closing their tab. It has NO knowledge of Clabber rules,
// so it never needs redeploying when the game changes.
//
// Env:
//   PORT      - TCP port to listen on (default 3030)
//   DATA_DIR  - directory for the on-disk document store (default ./data)

import http from 'node:http';
import { WebSocketServer } from 'ws';
import { Repo } from '@automerge/automerge-repo';
import { NodeWSServerAdapter } from '@automerge/automerge-repo-network-websocket';
import { NodeFSStorageAdapter } from '@automerge/automerge-repo-storage-nodefs';

const PORT = Number(process.env.PORT ?? 3030);
const DATA_DIR = process.env.DATA_DIR ?? './data';

const server = http.createServer((req, res) => {
	if (req.url === '/health') {
		res.writeHead(200, { 'content-type': 'text/plain' });
		res.end('ok');
		return;
	}
	res.writeHead(426, { 'content-type': 'text/plain' });
	res.end('Clabber Automerge sync server — connect over WebSocket.');
});

const wss = new WebSocketServer({ server });

const repo = new Repo({
	network: [new NodeWSServerAdapter(wss)],
	storage: new NodeFSStorageAdapter(DATA_DIR),
	// Relay everything: this server backs up every game doc it is told about.
	sharePolicy: async () => true
});

server.listen(PORT, () => {
	console.log(
		`clabber sync server listening on :${PORT}  (peer ${repo.peerId}, data: ${DATA_DIR})`
	);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
	process.on(sig, () => {
		console.log(`\n${sig} received, shutting down`);
		wss.close();
		server.close(() => process.exit(0));
	});
}
