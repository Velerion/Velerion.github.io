#!/usr/bin/env node
/*
 * Console version of the comparison, using the same structures as the website.
 *   node cli/demo.js            (17 buckets)
 *   node cli/demo.js 31         (31 buckets)
 */
'use strict';

const {
  ChainingHashTable, OpenAddressingHashTable, LinkedList, Stack, CircularQueue,
  hashSteps, randomCode, mulberry32,
} = require('../js/structures.js');
const { SEED_URLS, SEED_RNG } = require('./seed.js');

const buckets = Number(process.argv[2]) || 17;
const chain = new ChainingHashTable(buckets);
const oa = new OpenAddressingHashTable(17);
const list = new LinkedList();
const undo = new Stack();
const activity = new CircularQueue(5);

const line = (s = '') => console.log(s);
const rule = () => line('-'.repeat(72));

/* 1. shorten the 32 seed URLs */
line(`Velerion console demo: ${SEED_URLS.length} URLs, starting with ${buckets} buckets`);
rule();
const rng = mulberry32(SEED_RNG);
const used = new ChainingHashTable(53);
for (const url of SEED_URLS) {
  let code;
  do code = randomCode(rng); while (used.has(code));
  used.insert(code, true);
  chain.insert(code, url);
  oa.insert(code, url);
  list.append(code, url);
  activity.enqueue('shorten ' + code);
}

/* 2. show a collision being resolved (in the table as it is now, after any growth) */
line('COLLISION DEMONSTRATION');
const collided = chain.buckets.findIndex((b) => b.size > 1);
if (collided !== -1) {
  const keys = chain.buckets[collided].toArray().map((e) => e.key);
  const code = keys[keys.length - 1];
  const m = chain.bucketCount;
  line(`  hashing "${code}" with h = (h * 31 + charCode) mod ${m}:`);
  for (const st of hashSteps(code, m).steps) line(`    '${st.char}' (${st.code}):  ${st.prev} * 31 + ${st.code} = ${st.prev * 31 + st.code}  mod ${m} = ${st.next}`);
  line(`  bucket ${collided} already held [${keys.slice(0, -1).join(', ')}]`);
  line(`  resolved by chaining: "${code}" sits behind them in the same chain`);
  line(`  bucket ${collided}: ${keys.join(' -> ')} -> null`);
}
const s = chain.stats();
line(`  table growth: ${chain.growLog.map((g) => `${g.from} -> ${g.to} buckets at link #${g.atItem}`).join(', ') || 'none'}`);
line(`  total: ${s.collisions} collisions across ${s.collidedBuckets} buckets, longest chain ${s.longestChain}, alpha = ${s.loadFactor.toFixed(2)}`);
rule();

/* 3. retrieval comparisons */
line('RETRIEVAL COMPARISONS (key comparisons per lookup)');
line('  #   code    bucket  chaining  open-addr  linked-list');
let i = 0;
const tot = { c: 0, o: 0, l: 0 };
for (const node of list) {
  i++;
  const c = chain.get(node.key).comparisons;
  const o = oa.get(node.key).comparisons;
  const l = list.search(node.key).comparisons;
  tot.c += c; tot.o += o; tot.l += l;
  line(`  ${String(i).padStart(2)}  ${node.key}  ${String(chain.indexFor(node.key)).padStart(6)}  ${String(c).padStart(8)}  ${String(o).padStart(9)}  ${String(l).padStart(11)}`);
}
const n = list.size;
rule();
line(`  total   ${'chaining ' + tot.c}   open-addr ${tot.o}   linked-list ${tot.l}`);
line(`  average chaining ${(tot.c / n).toFixed(2)} | open-addr ${(tot.o / n).toFixed(2)} | linked list ${(tot.l / n).toFixed(2)}`);
line(`  the linked list needs ${(tot.l / tot.c).toFixed(1)}x more comparisons than the chaining hash table`);
rule();

/* 4. delete + undo (stack) and recent activity (circular queue) */
const victim = list.head.next.key;
const removed = chain.remove(victim);
oa.remove(victim);
list.remove(victim);
undo.push({ code: victim, url: removed.value });
activity.enqueue('delete ' + victim);
line(`DELETE ${victim}: removed from bucket ${removed.index}; pushed on undo stack (size ${undo.size})`);
line(`  retrieve ${victim} now -> found: ${chain.get(victim).found}`);
const back = undo.pop();
chain.insert(back.code, back.url);
oa.insert(back.code, back.url);
list.append(back.code, back.url);
activity.enqueue('undo ' + back.code);
line(`UNDO: popped ${back.code}, retrieve -> found: ${chain.get(back.code).found}`);
line(`RECENT ACTIVITY (circular queue, capacity 5): ${activity.toArray().join(' | ')}`);
