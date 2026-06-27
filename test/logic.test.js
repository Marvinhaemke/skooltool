import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffMembers } from '../src/services/diff.js';
import { renderTemplate, matches } from '../src/rules.js';
import { normalizeMember } from '../src/skool/client.js';

test('diffMembers detects a brand-new free member', () => {
  const prev = {};
  const current = [{ handle: 'alice', name: 'Alice', plan: null, isPaid: false, level: 1 }];
  const { events } = diffMembers(prev, current);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'new_member');
});

test('diffMembers detects a new paid member as both new_member and new_subscription', () => {
  const prev = {};
  const current = [{ handle: 'bob', name: 'Bob', plan: 'Pro', isPaid: true, level: 1 }];
  const { events } = diffMembers(prev, current);
  const types = events.map((e) => e.type).sort();
  assert.deepEqual(types, ['new_member', 'new_subscription']);
  assert.equal(events.find((e) => e.type === 'new_subscription').plan, 'Pro');
});

test('diffMembers detects free -> paid upgrade for existing member', () => {
  const prev = { carol: { handle: 'carol', name: 'Carol', plan: null, isPaid: false, level: 2 } };
  const current = [{ handle: 'carol', name: 'Carol', plan: 'Premium', isPaid: true, level: 2 }];
  const { events } = diffMembers(prev, current);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'new_subscription');
  assert.equal(events[0].previousPlan, null);
  assert.equal(events[0].plan, 'Premium');
});

test('diffMembers detects a level-up', () => {
  const prev = { dan: { handle: 'dan', name: 'Dan', plan: 'Pro', isPaid: true, level: 2 } };
  const current = [{ handle: 'dan', name: 'Dan', plan: 'Pro', isPaid: true, level: 4 }];
  const { events } = diffMembers(prev, current);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'level_reached');
  assert.equal(events[0].level, 4);
});

test('diffMembers reports nothing when unchanged', () => {
  const m = { handle: 'eve', name: 'Eve', plan: 'Pro', isPaid: true, level: 3 };
  const { events } = diffMembers({ eve: m }, [{ ...m }]);
  assert.equal(events.length, 0);
});

test('renderTemplate substitutes placeholders and blanks unknowns', () => {
  const out = renderTemplate('Hi {{name}}, plan {{plan}}, missing {{nope}}', {
    name: 'Sam',
    plan: 'Gold',
  });
  assert.equal(out, 'Hi Sam, plan Gold, missing ');
});

test('matches respects event type, plan and minLevel conditions', () => {
  const rule = { on: 'level_reached', when: { minLevel: 3 } };
  assert.equal(matches(rule, { type: 'level_reached', level: 4 }), true);
  assert.equal(matches(rule, { type: 'level_reached', level: 2 }), false);
  assert.equal(matches(rule, { type: 'new_member' }), false);

  const planRule = { on: 'new_subscription', when: { plan: ['Pro', 'Premium'] } };
  assert.equal(matches(planRule, { type: 'new_subscription', plan: 'Pro' }), true);
  assert.equal(matches(planRule, { type: 'new_subscription', plan: 'Basic' }), false);
});

test('normalizeMember pulls handle, plan and level from messy shapes', () => {
  const m = normalizeMember({
    handle: 'zoe',
    firstName: 'Zoe',
    lastName: 'Q',
    metadata: { email: 'zoe@example.com' },
    member: { planName: 'VIP', level: 5, isPaid: true },
  });
  assert.equal(m.handle, 'zoe');
  assert.equal(m.name, 'Zoe Q');
  assert.equal(m.email, 'zoe@example.com');
  assert.equal(m.plan, 'VIP');
  assert.equal(m.level, 5);
  assert.equal(m.isPaid, true);
});
