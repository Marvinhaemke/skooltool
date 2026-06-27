import { getStorage } from './storage.js';
import { logger } from './logger.js';

/**
 * Rules map detected events -> actions (post a webhook event and/or send a DM).
 * Defaults live here; you can override them without touching code by creating
 * data/rules.json with the same shape.
 *
 * Each rule:
 *   id        unique string
 *   on        event type: new_member | new_subscription | level_reached | course_completed
 *   when      optional match conditions:
 *               plan      string | string[]  (exact package match)
 *               minLevel  number             (level >= n)
 *   webhook   boolean — POST this event to ZAPIER_EVENT_WEBHOOK_URL
 *   dm        optional { template } — auto-DM the member (requires AUTO_DM_ENABLED=true)
 *
 * Templates support {{name}} {{handle}} {{plan}} {{level}} {{previousPlan}}.
 */
export const DEFAULT_RULES = [
  {
    id: 'welcome-new-member',
    on: 'new_member',
    webhook: false,
    dm: {
      template:
        "Hey {{name}}! 👋 Welcome to the community — so glad you're here. Reply here anytime if you need anything to get started.",
    },
  },
  {
    id: 'new-subscription-to-zapier',
    on: 'new_subscription',
    webhook: true,
    dm: {
      template:
        'Thanks so much for joining {{plan}}, {{name}}! 🎉 You now have full access — here is how to get the most out of it: [add your onboarding link].',
    },
  },
  {
    id: 'level-up',
    on: 'level_reached',
    when: { minLevel: 3 },
    webhook: true,
    dm: {
      template:
        "Congrats on reaching level {{level}}, {{name}}! 🔥 Your engagement is awesome — keep it going!",
    },
  },
  {
    id: 'course-completed',
    on: 'course_completed',
    webhook: true,
    dm: {
      template:
        'Huge congrats on finishing the course, {{name}}! 🎓 Want to share a win in the community feed?',
    },
  },
];

export async function loadRules() {
  const store = await getStorage();
  const custom = await store.getJSON('rules');
  if (Array.isArray(custom) && custom.length > 0) {
    logger.info({ count: custom.length }, 'Loaded custom rules from store');
    return custom;
  }
  return DEFAULT_RULES;
}

export async function saveRules(rules) {
  if (!Array.isArray(rules)) throw new Error('rules must be an array');
  const store = await getStorage();
  await store.setJSON('rules', rules);
  logger.info({ count: rules.length }, 'Saved custom rules');
  return rules;
}

/** Render a DM template with values from an event/member. */
export function renderTemplate(template, ctx) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const v = ctx[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

/** Does an event satisfy a rule's `when` conditions? */
export function matches(rule, event) {
  if (rule.on !== event.type) return false;
  const when = rule.when;
  if (!when) return true;

  if (when.plan) {
    const plans = Array.isArray(when.plan) ? when.plan : [when.plan];
    if (!event.plan || !plans.includes(event.plan)) return false;
  }
  if (typeof when.minLevel === 'number') {
    if (Number(event.level ?? 0) < when.minLevel) return false;
  }
  return true;
}
