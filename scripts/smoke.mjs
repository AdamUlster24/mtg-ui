// End-to-end smoke test of the gateway: two players, one Commander table, play until the first prompts.
// Usage: node scripts/smoke.mjs [ws://localhost:8080/ws]
const url = process.argv[2] || 'ws://localhost:8080/ws';
const spells = ['Savannah Lions', 'Elite Vanguard', 'Soul Warden', 'Serra Angel', 'Swords to Plowshares',
  'Pacifism', 'Glorious Anthem', 'Raise the Alarm', 'Thraben Inspector', 'Sol Ring', 'Honor of the Pure',
  'Disenchant', 'Wrath of God', 'Path to Exile', 'Benalish Marshal'];
const deck = ['Commander', '1 Isamaru, Hound of Konda', '', 'Deck', ...spells.map((s) => `1 ${s}`),
  `${99 - spells.length} Plains`].join('\n');

function client(name) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const events = [];
  let nextId = 1;
  const waiters = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'reply') {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error));
    } else {
      events.push(msg);
      console.log(`[${name}] ${msg.method}`, msg.method === 'CHATMESSAGE' ? msg.data.message.replace(/<[^>]+>/g, '').slice(0, 90)
        : msg.data?.message ? String(msg.data.message).replace(/<[^>]+>/g, '').slice(0, 90) : '');
      waiters.filter((w) => w.test(msg)).forEach((w) => { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); });
    }
  };
  const send = (cmd, args = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, cmd, ...args }));
  });
  const waitFor = (test, ms = 20000) => {
    const found = events.find(test);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      waiters.push({ test, resolve });
      setTimeout(() => reject(new Error(`${name}: timeout waiting for event`)), ms);
    });
  };
  const open = new Promise((resolve) => { ws.onopen = resolve; });
  return { name, ws, send, waitFor, events, open };
}

const a = client('alice');
const b = client('bob');
await Promise.all([a.open, b.open]);
await a.send('hello');
await b.send('hello');
console.log('check deck:', JSON.stringify(await a.send('checkDeck', { deck })));
const la = await a.send('login', { username: 'alice' + (Date.now() % 1000) });
const lb = await b.send('login', { username: 'bob' + (Date.now() % 1000) });
console.log('logged in:', la.userName, lb.userName, '| commander game types:', la.gameTypes.filter((t) => /Commander/.test(t)).length);

const table = await a.send('createTable', { deck });
console.log('table:', table.id, table.gameType, table.deckType, table.state);
console.log('tables seen by bob:', (await b.send('tables')).map((t) => `${t.name} [${t.state}]`));
await b.send('joinTable', { tableId: table.id, deck });
await a.send('startMatch', { tableId: table.id });

const start = await a.waitFor((m) => m.method === 'START_GAME');
const gameId = start.data.gameId;
console.log('game started:', gameId, 'chat:', start.data.chatId);

// answer the first prompts (who goes first, mulligans) until someone gets priority
for (let i = 0; i < 12; i++) {
  const isPrompt = (m) => /^GAME_(ASK|SELECT|TARGET|CHOOSE_CHOICE)$/.test(m.method) && !m.done;
  const [who, msg] = await Promise.race([a, b].map((c) => c.waitFor(isPrompt).then((m) => [c, m])));
  msg.done = true;
  const g = msg.data.game;
  console.log(`-> ${who.name} ${msg.method}: "${String(msg.data.message).replace(/<[^>]+>/g, '')}" turn ${g.turn} ${g.step} hand=${g.hand.length}`);
  if (msg.method === 'GAME_SELECT') {
    const me = g.players.find((p) => p.id === g.myPlayerId);
    console.log('   players:', g.players.map((p) => `${p.name} life=${p.life} lib=${p.libraryCount} cmd=${p.commandZone.map((c) => c.name)}`).join(' | '));
    console.log('   hand:', g.hand.map((c) => `${c.name}${c.playable ? '*' : ''}`).join(', '));
    const land = g.hand.find((c) => c.playable && c.types.includes('LAND'));
    if (land && me.battlefield.length === 0) {
      await who.send('respond', { gameId, kind: 'uuid', value: land.id });
      const after = await who.waitFor((m) => m.data?.game?.players?.some((p) => p.battlefield.length > 0));
      console.log('   played a land, battlefield:', after.data.game.players.flatMap((p) => p.battlefield.map((c) => c.name)));
      break;
    }
    await who.send('respond', { gameId, kind: 'boolean', value: false });
  } else if (msg.method === 'GAME_ASK') {
    await who.send('respond', { gameId, kind: 'boolean', value: !/mulligan/i.test(msg.data.message) });
  } else if (msg.method === 'GAME_TARGET') {
    await who.send('respond', { gameId, kind: 'uuid', value: msg.data.targets[0] ?? g.players[0].id });
  } else {
    await who.send('respond', { gameId, kind: 'string', value: msg.data.choice.items[0].key });
  }
}
const res = await fetch(url.replace('ws', 'http').replace('/ws', '/img/card?set=CHK&number=19&name=Isamaru%2C%20Hound%20of%20Konda'));
console.log('image proxy:', res.status, res.headers.get('content-type'), (await res.arrayBuffer()).byteLength, 'bytes');
await a.send('action', { gameId, action: 'CONCEDE' });
await a.waitFor((m) => m.method === 'GAME_OVER' || m.method === 'END_GAME_INFO');
console.log('SMOKE OK');
process.exit(0);
