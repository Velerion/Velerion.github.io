/*
 * structures.js — every data structure used by the URL shortener, written by hand.
 * No built-in Map / Set / object-as-dictionary is used for storage.
 *
 *   hashIndex / hashSteps    – the hash function, small enough to follow with pen and paper
 *   LinkedList               – singly linked list; sequential-search baseline
 *   ChainingHashTable        – array of buckets, each bucket is a LinkedList (separate chaining)
 *   OpenAddressingHashTable  – linear probing with tombstones
 *   Stack                    – linked stack (undo for deletes)            [CO1]
 *   CircularQueue            – fixed-size ring buffer (recent activity)    [CO1]
 *
 * Growing (both tables follow the same rule):
 *   when the table gets too full, make it about twice as big (the next prime number
 *   after 2 × size) and re-insert every key, because each key's index depends on the size.
 *     – chaining grows when there are more links than buckets (load factor > 1)
 *     – open addressing grows when more than 70% of slots are used
 *
 * Works in the browser (window.DSA) and in Node (module.exports) so the same code
 * powers both the web app and the console demo in cli/demo.js.
 */
(function (global) {
  'use strict';

  const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

  /*
   * Hash function. For each character of the code:
   *     h = (h × 31 + character code) mod tableSize
   * Taking the remainder at every step keeps the numbers small (always below the table
   * size), and gives exactly the same answer as computing the whole polynomial first.
   */
  function hashIndex(key, size) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % size;
    return h;
  }

  /* Same calculation, but records every step so the UI can show the working. */
  function hashSteps(key, size) {
    const steps = [];
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      const code = key.charCodeAt(i);
      const next = (h * 31 + code) % size;
      steps.push({ char: key[i], code, prev: h, next });
      h = next;
    }
    return { index: h, steps };
  }

  function isPrime(n) {
    if (n < 2) return false;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
    return true;
  }

  function nextPrime(n) {
    while (!isPrime(n)) n++;
    return n;
  }

  /* Deterministic PRNG so the seed data (and its collisions) is identical on every machine. */
  function mulberry32(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomCode(rng = Math.random, length = 5) {
    let code = '';
    for (let i = 0; i < length; i++) code += BASE62[Math.floor(rng() * 62)];
    return code;
  }

  /* ------------------------------------------------------------------ */
  /* Linked list                                                         */
  /* ------------------------------------------------------------------ */

  class ListNode {
    constructor(key, value) {
      this.key = key;
      this.value = value;
      this.next = null;
    }
  }

  class LinkedList {
    constructor() {
      this.head = null;
      this.tail = null;
      this.size = 0;
    }

    append(key, value) {
      const node = new ListNode(key, value);
      if (!this.head) {
        this.head = this.tail = node;
      } else {
        this.tail.next = node;
        this.tail = node;
      }
      this.size++;
      return node;
    }

    /* Sequential search: walks from head, counting one comparison per node visited. */
    search(key) {
      let comparisons = 0;
      const path = [];
      let cur = this.head;
      while (cur) {
        comparisons++;
        path.push(cur.key);
        if (cur.key === key) return { found: true, value: cur.value, comparisons, path };
        cur = cur.next;
      }
      return { found: false, value: undefined, comparisons, path };
    }

    remove(key) {
      let comparisons = 0;
      let prev = null;
      let cur = this.head;
      while (cur) {
        comparisons++;
        if (cur.key === key) {
          if (prev) prev.next = cur.next;
          else this.head = cur.next;
          if (this.tail === cur) this.tail = prev;
          this.size--;
          return { removed: true, value: cur.value, comparisons };
        }
        prev = cur;
        cur = cur.next;
      }
      return { removed: false, value: undefined, comparisons };
    }

    *[Symbol.iterator]() {
      let cur = this.head;
      while (cur) {
        yield cur;
        cur = cur.next;
      }
    }

    toArray() {
      const out = [];
      for (const node of this) out.push({ key: node.key, value: node.value });
      return out;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Hash table — separate chaining                                      */
  /* ------------------------------------------------------------------ */

  class ChainingHashTable {
    /* autoGrow = false keeps the size fixed (used by the load-factor experiment). */
    constructor(bucketCount = 17, { autoGrow = true, maxLoad = 1 } = {}) {
      this.autoGrow = autoGrow;
      this.maxLoad = maxLoad;
      this.size = 0;
      this.growLog = [];
      this._allocate(bucketCount);
    }

    _allocate(bucketCount) {
      this.bucketCount = bucketCount;
      this.buckets = [];
      for (let i = 0; i < bucketCount; i++) this.buckets.push(new LinkedList());
    }

    indexFor(key) {
      return hashIndex(key, this.bucketCount);
    }

    insert(key, value) {
      if (this.has(key)) return { ok: false, reason: 'duplicate' };

      let grew = null;
      if (this.autoGrow && (this.size + 1) / this.bucketCount > this.maxLoad) {
        grew = this._grow(nextPrime(this.bucketCount * 2), this.size + 1);
      }

      const index = this.indexFor(key);
      const bucket = this.buckets[index];
      // A collision: the bucket this key hashes to already holds at least one other key.
      const collision = bucket.size > 0;
      const occupants = bucket.toArray().map((e) => e.key);
      const chainedBehind = collision ? bucket.tail.key : null;
      bucket.append(key, value);
      this.size++;
      return { ok: true, index, collision, occupants, chainedBehind, chainLength: bucket.size, grew };
    }

    _grow(newCount, atItem) {
      const old = this.buckets;
      const info = { from: this.bucketCount, to: newCount, atItem };
      this._allocate(newCount);
      for (const bucket of old) {
        for (const node of bucket) this.buckets[this.indexFor(node.key)].append(node.key, node.value);
      }
      this.growLog.push(info);
      return info;
    }

    get(key) {
      const index = this.indexFor(key);
      return Object.assign({ index }, this.buckets[index].search(key));
    }

    has(key) {
      return this.get(key).found;
    }

    remove(key) {
      const index = this.indexFor(key);
      const result = this.buckets[index].remove(key);
      if (result.removed) this.size--;
      return Object.assign({ index }, result);
    }

    get loadFactor() {
      return this.size / this.bucketCount;
    }

    stats() {
      let longestChain = 0;
      let emptyBuckets = 0;
      let collisions = 0;
      let collidedBuckets = 0;
      for (const bucket of this.buckets) {
        if (bucket.size > longestChain) longestChain = bucket.size;
        if (bucket.size === 0) emptyBuckets++;
        if (bucket.size > 1) {
          collisions += bucket.size - 1;
          collidedBuckets++;
        }
      }
      return {
        size: this.size,
        bucketCount: this.bucketCount,
        loadFactor: this.loadFactor,
        longestChain,
        emptyBuckets,
        collisions,
        collidedBuckets,
      };
    }
  }

  /* ------------------------------------------------------------------ */
  /* Hash table — open addressing (linear probing)                       */
  /* ------------------------------------------------------------------ */

  const TOMBSTONE = Object.freeze({ tombstone: true });

  class OpenAddressingHashTable {
    constructor(capacity = 17, maxLoad = 0.7) {
      this.capacity = capacity;
      this.maxLoad = maxLoad;
      this.slots = new Array(capacity).fill(null);
      this.size = 0;
      this.tombstones = 0;
      this.growLog = [];
    }

    homeIndex(key) {
      return hashIndex(key, this.capacity);
    }

    insert(key, value) {
      if (this.has(key)) return { ok: false, reason: 'duplicate' };

      // Tombstones still occupy a slot during probing, so they count towards "full".
      let grew = null;
      if ((this.size + this.tombstones + 1) / this.capacity > this.maxLoad) {
        grew = this._grow(nextPrime(this.capacity * 2), this.size + 1);
      }

      const home = this.homeIndex(key);
      const path = [];
      let idx = home;
      // Linear probing: try home, home+1, home+2, … (wrapping round) until a free slot.
      while (this.slots[idx] !== null && this.slots[idx] !== TOMBSTONE) {
        path.push(idx);
        idx = (idx + 1) % this.capacity;
      }
      path.push(idx);
      if (this.slots[idx] === TOMBSTONE) this.tombstones--;
      this.slots[idx] = { key, value };
      this.size++;
      return { ok: true, index: idx, home, path, collision: idx !== home, grew };
    }

    get(key) {
      const home = this.homeIndex(key);
      const path = [];
      let comparisons = 0;
      for (let i = 0; i < this.capacity; i++) {
        const idx = (home + i) % this.capacity;
        const slot = this.slots[idx];
        path.push(idx);
        if (slot === null) break; // an empty slot ends the search
        if (slot === TOMBSTONE) continue; // a deleted slot: keep probing
        comparisons++;
        if (slot.key === key) {
          return { found: true, value: slot.value, index: idx, home, path, comparisons };
        }
      }
      return { found: false, value: undefined, index: -1, home, path, comparisons };
    }

    has(key) {
      return this.get(key).found;
    }

    /* Deleting leaves a tombstone so later probe sequences are not cut short. */
    remove(key) {
      const result = this.get(key);
      if (!result.found) return Object.assign({ removed: false }, result);
      this.slots[result.index] = TOMBSTONE;
      this.size--;
      this.tombstones++;
      return Object.assign({ removed: true }, result);
    }

    _grow(newCapacity, atItem) {
      const live = this.slots.filter((s) => s !== null && s !== TOMBSTONE);
      const info = { from: this.capacity, to: newCapacity, atItem };
      this.capacity = newCapacity;
      this.slots = new Array(newCapacity).fill(null);
      this.size = 0;
      this.tombstones = 0;
      for (const entry of live) {
        let idx = this.homeIndex(entry.key);
        while (this.slots[idx] !== null) idx = (idx + 1) % this.capacity;
        this.slots[idx] = entry;
        this.size++;
      }
      this.growLog.push(info);
      return info;
    }

    get loadFactor() {
      return this.size / this.capacity;
    }

    stats() {
      let displaced = 0;
      for (let i = 0; i < this.capacity; i++) {
        const slot = this.slots[i];
        if (slot !== null && slot !== TOMBSTONE && this.homeIndex(slot.key) !== i) displaced++;
      }
      return {
        size: this.size,
        capacity: this.capacity,
        loadFactor: this.loadFactor,
        tombstones: this.tombstones,
        displaced,
      };
    }
  }

  /* ------------------------------------------------------------------ */
  /* Stack (linked) and circular queue — CO1                             */
  /* ------------------------------------------------------------------ */

  class Stack {
    constructor() {
      this.top = null;
      this.size = 0;
    }

    push(value) {
      const node = new ListNode(null, value);
      node.next = this.top;
      this.top = node;
      this.size++;
    }

    pop() {
      if (!this.top) return undefined;
      const value = this.top.value;
      this.top = this.top.next;
      this.size--;
      return value;
    }

    peek() {
      return this.top ? this.top.value : undefined;
    }

    isEmpty() {
      return this.size === 0;
    }

    /* Top of stack first. */
    toArray() {
      const out = [];
      for (let cur = this.top; cur; cur = cur.next) out.push(cur.value);
      return out;
    }
  }

  class CircularQueue {
    constructor(capacity = 10) {
      this.capacity = capacity;
      this.items = new Array(capacity);
      this.front = 0;
      this.count = 0;
    }

    isEmpty() {
      return this.count === 0;
    }

    isFull() {
      return this.count === this.capacity;
    }

    /* When full, the oldest item is dequeued to make room; it is returned to the caller. */
    enqueue(value) {
      const evicted = this.isFull() ? this.dequeue() : undefined;
      const rear = (this.front + this.count) % this.capacity;
      this.items[rear] = value;
      this.count++;
      return evicted;
    }

    dequeue() {
      if (this.isEmpty()) return undefined;
      const value = this.items[this.front];
      this.items[this.front] = undefined;
      this.front = (this.front + 1) % this.capacity;
      this.count--;
      return value;
    }

    /* Oldest first. */
    toArray() {
      const out = [];
      for (let i = 0; i < this.count; i++) out.push(this.items[(this.front + i) % this.capacity]);
      return out;
    }
  }

  const api = {
    BASE62,
    hashIndex,
    hashSteps,
    isPrime,
    nextPrime,
    mulberry32,
    randomCode,
    ListNode,
    LinkedList,
    ChainingHashTable,
    OpenAddressingHashTable,
    TOMBSTONE,
    Stack,
    CircularQueue,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DSA = api;
})(typeof window !== 'undefined' ? window : globalThis);
