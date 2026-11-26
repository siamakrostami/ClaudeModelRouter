// Roles in tie-break order: most capable first.
export const ROLES = ['plan', 'review', 'hard', 'code', 'write', 'chores'];
export const MODELS = ['fable', 'opus', 'sonnet', 'haiku'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export const DEFAULT_SETUP = {
  plan: { model: 'fable', effort: 'xhigh' },
  review: { model: 'fable', effort: 'high' },
  hard: { model: 'opus', effort: 'high' },
  code: { model: 'sonnet', effort: 'medium' },
  write: { model: 'sonnet', effort: 'medium' },
  chores: { model: 'haiku', effort: 'low' },
};

export const ROLE_INFO = {
  plan: 'Planning, architecture, big decisions',
  review: 'Code review',
  hard: 'Hard code, UI work, debugging',
  code: 'Regular code, tests, refactors',
  write: 'Prose people read: PRs, Slack, docs, tickets',
  chores: 'Git ops, renames, formatting, lookups, commit messages',
};

// Case-insensitive regex sources; each pattern that matches adds 1 to the role's score.
// Rules key on what the user asks for (a verb plus its object), not on nouns that merely appear.
export const DEFAULT_RULES = {
  plan: [
    "^\\W*(let'?s |can you |could you |please |help me )?plan\\b",
    '\\b(make|write|draft) (a|the) plan\\b',
    '\\bplan (out|for how|how)\\b',
    '\\barchitect',
    'design doc',
    'trade-?offs?',
    'roadmap',
    '\\brfc\\b',
    'how should (we|i) (build|structure|design|approach|organi[sz]e)',
    "what'?s the best (approach|way) to",
    'strategy for',
  ],
  review: [
    '^\\W*(please |can you |could you )?review\\b',
    '\\breview (this|the|my|our|these|that|pr|diff|code|changes|branch)\\b',
    'code review',
    '\\baudit\\b',
    'look over (my|this|the)',
    'check (my|this|the) (code|pr|diff) for',
    'is there (a|any) (bug|issue|problem)s? (in|with)',
  ],
  hard: [
    '\\bdebug',
    '\\bcrash',
    '\\brace( condition)?\\b',
    '\\bflaky',
    'stack ?trace',
    'regression',
    'root cause',
    'why (is|does|did)\\b.*\\b(fail|break|crash|hang|freeze)',
    '\\bui\\b',
    '\\bscreens?\\b',
    '\\blayout',
    'animation',
    'swiftui',
    'jetpack compose',
    'memory leak',
    'deadlock',
    '\\b(performance|too slow)\\b',
  ],
  code: [
    '\\bimplement',
    'execute (the|this|our) plan',
    '^\\W*(please )?(add|create|build|make)\\b',
    '\\badd (a |an |the )?(new )?\\w+ (to|for|in)\\b',
    'write (a |an |the )?(function|test|class|script|migration)',
    '\\bfix\\b',
    '\\brefactor',
    '\\bbug\\b',
    'unit tests?',
    'address (the )?(review )?comments',
    '\\b(pick up|start on|work on)\\b',
    '\\bupdate (the )?\\w+( \\w+)? (field|model|function|method|class|component|endpoint|view)\\b',
    '\\bformat (the )?\\S+( \\S+)? as\\b',
  ],
  write: [
    'pr description',
    '\\bslack\\b',
    '\\b(write|draft|compose) (a |an |the )?(short )?(reply|email|message|post|announcement|update)\\b',
    '\\breply to (the |this |his |her |their )?(slack|thread|email|message|comment)',
    '\\breadme\\b',
    'documentation',
    '\\b(write|draft|update) (the )?docs\\b',
    'release notes',
    'daily update',
    'confluence (page|doc)',
    '(write|draft) (a |the )?(jira )?ticket',
    'write ?up\\b',
  ],
  chores: [
    'commit message',
    '\\brename',
    '\\b(run|fix) (the )?(formatter|linter|lint|prettier|swiftformat|swiftlint|eslint)',
    '\\blint\\b',
    '\\bformat (the )?(code|files?|project)\\b',
    'move (the )?files?',
    'bump (the )?version',
    'git (status|log|add|stash|diff|branch)',
    'look ?up\\b',
    '^\\W*(where is|which (file|line))',
    'find (the )?(files?|lines?) (that|where|with|containing)',
    'list (all |the )?files',
    'summari[sz]e',
  ],
};

export const AGENT_PREFIX = 'switchboard:router-';

export function agentName(role) {
  return AGENT_PREFIX + role;
}

/** Map an Agent tool subagent_type to a role, accepting namespaced or bare names. */
export function roleFromAgent(subagentType) {
  if (typeof subagentType !== 'string') return null;
  const m = /^(?:switchboard:)?router-([a-z]+)$/.exec(subagentType);
  return m && ROLES.includes(m[1]) ? m[1] : null;
}
