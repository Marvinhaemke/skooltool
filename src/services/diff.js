/**
 * Compute what changed between the previous member snapshot and a freshly
 * scraped list. Produces a structured set of events that the trigger engine
 * consumes. Pure function — no side effects, easy to unit test.
 *
 * @param {Record<string, object>} prev  handle -> previous member record
 * @param {object[]} current  freshly scraped member records
 */
export function diffMembers(prev, current) {
  const events = [];
  const byHandle = {};

  for (const m of current) {
    byHandle[m.handle] = m;
    const before = prev[m.handle];

    if (!before) {
      events.push({ type: 'new_member', handle: m.handle, member: m });
      // A brand-new member who already has a paid plan is also a new purchase.
      if (m.plan || m.isPaid) {
        events.push({ type: 'new_subscription', handle: m.handle, member: m, plan: m.plan ?? null });
      }
      continue;
    }

    // Existing member upgraded from free -> paid, or changed package.
    const planBefore = before.plan ?? null;
    const planAfter = m.plan ?? null;
    const becamePaid = !before.isPaid && m.isPaid;
    if ((planAfter && planAfter !== planBefore) || becamePaid) {
      events.push({
        type: 'new_subscription',
        handle: m.handle,
        member: m,
        plan: planAfter,
        previousPlan: planBefore,
      });
    }

    // Level increased (gamification milestone).
    const lvlBefore = Number(before.level ?? 0);
    const lvlAfter = Number(m.level ?? 0);
    if (Number.isFinite(lvlAfter) && lvlAfter > lvlBefore) {
      events.push({
        type: 'level_reached',
        handle: m.handle,
        member: m,
        level: lvlAfter,
        previousLevel: lvlBefore,
      });
    }
  }

  return { events, byHandle };
}
