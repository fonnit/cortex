// Tests for scripts/acc/lib/trace-walker.mjs
//
// Run with the built-in Node test runner — no Langfuse network calls.
// Usage: node --test scripts/acc/__tests__/trace-walker.test.mjs

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  walkSpanChain,
  REQUIRED_SPAN_NAMES,
} from '../lib/trace-walker.mjs'

// Helpers — mock Langfuse trace summaries (only the fields the walker reads)
const t = (name, id, metadata = {}) => ({ id, name, metadata })

describe('walkSpanChain', () => {
  test('happy path Stage 1 only (ignore item) — chain reconstructable', () => {
    const traces = [
      t('api-ingest', 'tr-ingest-1', { item_id: 'itm-1' }),
      t('api-queue', 'tr-queue-1', { item_id: 'itm-1' }),
      t('consumer-stage1-item', 'tr-s1-1', {
        item_id: 'itm-1',
        inbound_trace_id: 'tr-queue-1',
      }),
      t('api-classify', 'tr-cls-1', { item_id: 'itm-1' }),
    ]
    const result = walkSpanChain(traces)
    assert.equal(result.ok, true)
    assert.deepEqual(result.missing, [])
    assert.deepEqual(result.broken, [])
    assert.deepEqual(result.chain, [
      'api-ingest',
      'api-queue',
      'consumer-stage1-item',
      'api-classify',
    ])
  })

  test('missing api-classify reports it in `missing`', () => {
    const traces = [
      t('api-ingest', 'tr-ingest-1'),
      t('api-queue', 'tr-queue-1'),
      t('consumer-stage1-item', 'tr-s1-1', {
        inbound_trace_id: 'tr-queue-1',
      }),
    ]
    const result = walkSpanChain(traces)
    assert.equal(result.ok, false)
    assert.ok(result.missing.includes('api-classify'))
  })

  test('stage1 trace with dangling inbound_trace_id reports broken link', () => {
    const traces = [
      t('api-ingest', 'tr-ingest-1'),
      t('api-queue', 'tr-queue-1'),
      t('consumer-stage1-item', 'tr-s1-1', {
        inbound_trace_id: 'tr-queue-NOPE',
      }),
      t('api-classify', 'tr-cls-1'),
    ]
    const result = walkSpanChain(traces)
    assert.equal(result.ok, false)
    assert.ok(result.broken.some((b) => b.includes('dangling_inbound')))
  })

  test('stage2-only path accepted (--require-stage2 set)', () => {
    const traces = [
      t('api-ingest', 'tr-ingest-1'),
      t('api-queue', 'tr-queue-1'),
      t('consumer-stage2-item', 'tr-s2-1', {
        inbound_trace_id: 'tr-queue-1',
      }),
      t('api-classify', 'tr-cls-1'),
    ]
    const result = walkSpanChain(traces, { requireStage2: true })
    assert.equal(result.ok, true)
    assert.deepEqual(result.chain, [
      'api-ingest',
      'api-queue',
      'consumer-stage2-item',
      'api-classify',
    ])
  })

  test('keep item: both stage1 and stage2 traces present, chain ok', () => {
    const traces = [
      t('api-ingest', 'tr-ingest-1'),
      t('api-queue', 'tr-queue-1'),
      t('consumer-stage1-item', 'tr-s1-1', {
        inbound_trace_id: 'tr-queue-1',
      }),
      t('api-queue', 'tr-queue-2'),
      t('consumer-stage2-item', 'tr-s2-1', {
        inbound_trace_id: 'tr-queue-2',
      }),
      t('api-classify', 'tr-cls-1'),
    ]
    const result = walkSpanChain(traces)
    assert.equal(result.ok, true)
    // default mode picks stage1 if present; that's still a green chain.
    assert.ok(result.chain.includes('consumer-stage1-item'))
    assert.ok(result.chain.includes('api-ingest'))
    assert.ok(result.chain.includes('api-queue'))
    assert.ok(result.chain.includes('api-classify'))
  })

  test('empty trace array → missing all required spans', () => {
    const result = walkSpanChain([])
    assert.equal(result.ok, false)
    // The default-stage choice picks stage2 when neither stage1 nor stage2
    // is present — either way the chain is empty and three core spans are
    // missing. We just assert at least the core API spans are flagged.
    assert.ok(result.missing.includes('api-ingest'))
    assert.ok(result.missing.includes('api-queue'))
    assert.ok(result.missing.includes('api-classify'))
  })

  test('REQUIRED_SPAN_NAMES is frozen and exposes the canonical names', () => {
    assert.equal(REQUIRED_SPAN_NAMES.apiIngest, 'api-ingest')
    assert.equal(REQUIRED_SPAN_NAMES.apiQueue, 'api-queue')
    assert.equal(REQUIRED_SPAN_NAMES.apiClassify, 'api-classify')
    assert.equal(REQUIRED_SPAN_NAMES.stage1Item, 'consumer-stage1-item')
    assert.equal(REQUIRED_SPAN_NAMES.stage2Item, 'consumer-stage2-item')
    assert.equal(Object.isFrozen(REQUIRED_SPAN_NAMES), true)
  })
})
