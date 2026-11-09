import { money } from './util.js';

const CATEGORIES = [
  ['Food & Drinks', ['uber eats', 'ubereats', 'doordash', 'grubhub', 'starbucks', 'mcdonald', 'chick-fil', 'chickfil', 'chipotle', 'dunkin', 'taco bell', 'wendy', 'panera', 'subway', 'pizza', 'domino', 'cafe', 'coffee', 'sonic', 'burger', 'kfc', 'popeyes', 'five guys', 'raising cane', 'canes', 'dairy queen', 'boba', 'bubble tea', 'jersey mike', 'jimmy john', 'qdoba', 'arby', 'culver', 'skyline', 'tim horton', 'dutch bros', 'smoothie', 'crumbl', 'insomnia', 'krispy', 'wingstop', 'buffalo wild', 'applebee', 'olive garden', 'ihop', 'waffle', 'donut', 'bakery', 'grill', 'kitchen', 'diner', 'sushi', 'noodle', 'restaurant', 'chili', 'cava', 'sweetgreen', 'jeni', 'ice cream', 'lunch', 'dinner', 'breakfast', 'snack', 'drink', 'soda', 'food']],
  ['Getting Around', ['uber', 'lyft', 'cota', 'parking', 'transit', 'metro', 'lime', 'bird']],
  ['Gas & Convenience', ['7-eleven', '7 eleven', 'speedway', 'circle k', 'wawa', 'sheetz', 'shell', 'marathon', 'sunoco', 'exxon', 'mobil', 'casey', 'united dairy', 'udf', 'gas', 'fuel', 'bp ']],
  ['Shopping', ['amazon', 'target', 'walmart', 'nike', 'adidas', 'h&m', 'zara', 'shein', 'old navy', 'gap', 'american eagle', 'hollister', 'abercrombie', 'urban outfitters', 'pacsun', 'foot locker', 'dick', 'five below', 'tj maxx', 'marshalls', 'kohl', 'macy', 'best buy', 'gamestop', 'etsy', 'temu', 'ebay', 'mall', 'outlet', 'claire', 'journeys', 'vans', 'lululemon', 'hobby lobby', 'michaels']],
  ['Games & Fun', ['steam', 'playstation', 'xbox', 'nintendo', 'roblox', 'fortnite', 'epic games', 'twitch', 'amc', 'regal', 'cinemark', 'movie', 'theater', 'theatre', 'ticketmaster', 'stubhub', 'round1', 'dave & buster', 'topgolf', 'bowling', 'arcade', 'skate', 'trampoline', 'escape room', 'mini golf', 'spotify', 'netflix', 'hulu', 'disney', 'youtube', 'apple.com', 'itunes', 'app store', 'google play', 'discord', 'max.com', 'paramount']],
  ['Beauty & Care', ['ulta', 'sephora', 'cvs', 'walgreens', 'rite aid', 'salon', 'barber', 'nail', 'bath & body', 'bath and body']],
  ['School', ['bookstore', 'staples', 'office depot', 'school', 'college board', 'scholastic']],
  ['Groceries', ['kroger', 'meijer', 'aldi', 'giant eagle', 'trader joe', 'whole foods', 'costco', "sam's club", 'publix', 'safeway', 'grocery', 'market']],
];

const SUBSCRIPTIONS = ['spotify', 'netflix', 'hulu', 'disney', 'youtube', 'apple.com', 'itunes', 'max.com', 'paramount', 'xbox game pass', 'playstation plus', 'discord nitro', 'snapchat'];

export const CATEGORY_NAMES = [...CATEGORIES.map((c) => c[0]), 'Cash buys', 'Other'];

export function categorize(merchant, source) {
  const m = ' ' + String(merchant || '').toLowerCase() + ' ';
  for (const [name, words] of CATEGORIES) {
    if (words.some((w) => m.includes(w))) return name;
  }
  return source === 'cash' ? 'Cash buys' : 'Other';
}

export function summarize(txs, budget = 50) {
  const list = txs.map((t) => ({ ...t, amount: Number(t.amount) }));
  const total = round(list.reduce((s, t) => s + t.amount, 0));
  const cats = new Map();
  const merchants = new Map();
  for (const t of list) {
    const c = cats.get(t.category) || { category: t.category, total: 0, count: 0 };
    c.total += t.amount;
    c.count += 1;
    cats.set(t.category, c);
    const key = String(t.merchant || 'Unknown');
    const m = merchants.get(key) || { name: key, total: 0, count: 0 };
    m.total += t.amount;
    m.count += 1;
    merchants.set(key, m);
  }
  const byCategory = [...cats.values()]
    .map((c) => ({ ...c, total: round(c.total), pct: total ? Math.round((c.total / total) * 100) : 0 }))
    .sort((a, b) => b.total - a.total);
  const topMerchant = [...merchants.values()].sort((a, b) => b.total - a.total)[0] || null;
  const small = list.filter((t) => t.amount < 5);
  const subs = [...new Set(list.filter((t) => SUBSCRIPTIONS.some((s) => String(t.merchant).toLowerCase().includes(s))).map((t) => t.merchant))];
  const b = Number(budget) || 0;
  return {
    total,
    count: list.length,
    budget: b,
    left: round(b - total),
    pctOfBudget: b ? Math.round((total / b) * 100) : 0,
    byCategory,
    topMerchant: topMerchant ? { ...topMerchant, total: round(topMerchant.total) } : null,
    smallCount: small.length,
    smallTotal: round(small.reduce((s, t) => s + t.amount, 0)),
    subscriptions: subs,
    biggest: list.slice().sort((a, b2) => b2.amount - a.amount)[0] || null,
  };
}

// Returns tips ordered by usefulness. Each tip is plain text that fits in a text message.
export function tipsFor(s, prevTotal = null) {
  const tips = [];
  if (s.count === 0) {
    tips.push({ key: 'none', text: 'No purchases were logged this week. If you did spend, open your TeenLedger page and check that auto logging is on.' });
    return tips;
  }
  if (s.budget && s.total > s.budget) {
    const daily = Math.max(1, Math.floor(s.budget / 7));
    tips.push({ key: 'over', text: `You went ${money(s.total - s.budget)} over your ${money(s.budget)} budget. Try a ${money(daily)} a day limit next week to get back on track.` });
  }
  const food = s.byCategory.find((c) => c.category === 'Food & Drinks');
  if (food && food.pct >= 30 && food.count >= 2) {
    const avg = food.total / food.count;
    tips.push({ key: 'food', text: `Food and drinks were ${food.pct}% of your spending (${money(food.total)}). Skipping 2 of those buys a week saves about ${money(Math.round(avg * 2 * 4.33))} a month.` });
  }
  if (s.smallCount >= 4) {
    tips.push({ key: 'small', text: `${s.smallCount} buys under $5 added up to ${money(s.smallTotal)}. Small buys are the easiest ones to cut.` });
  }
  if (s.subscriptions.length) {
    tips.push({ key: 'subs', text: `You paid for ${s.subscriptions.length === 1 ? 'a subscription' : s.subscriptions.length + ' subscriptions'} this week (${s.subscriptions.slice(0, 3).join(', ')}). Cancel the one you use least.` });
  }
  if (prevTotal !== null && prevTotal > 0) {
    const diff = round(s.total - prevTotal);
    if (diff <= -5) tips.push({ key: 'down', text: `You spent ${money(-diff)} less than last week. Keep it going.` });
    else if (diff >= 10) tips.push({ key: 'up', text: `You spent ${money(diff)} more than last week. Check your biggest buy and ask if it was worth it.` });
  }
  if (s.budget && s.total <= s.budget) {
    tips.push({ key: 'under', text: `You stayed ${money(s.budget - s.total)} under budget. Move it to savings and that is about ${money(Math.round((s.budget - s.total) * 4.33))} a month.` });
  }
  if (s.topMerchant && s.topMerchant.count >= 3) {
    tips.push({ key: 'repeat', text: `You went to ${s.topMerchant.name} ${s.topMerchant.count} times (${money(s.topMerchant.total)}). Set a limit of 2 visits next week.` });
  }
  return tips;
}

export function weeklySms(name, s, tips, link) {
  const lines = [];
  lines.push(`TeenLedger Sunday check, ${name}:`);
  if (s.count === 0) {
    lines.push('No buys logged this week.');
  } else {
    const vs = s.budget ? (s.total <= s.budget ? ` (${money(s.budget - s.total)} under your ${money(s.budget)} budget)` : ` (${money(s.total - s.budget)} over your ${money(s.budget)} budget)`) : '';
    lines.push(`Spent ${money(s.total)} on ${s.count} buy${s.count === 1 ? '' : 's'}${vs}.`);
    const top = s.byCategory.slice(0, 3).map((c) => `${c.category} ${money(c.total)}`).join(', ');
    if (top) lines.push(`Top: ${top}.`);
  }
  if (tips[0]) lines.push(`Tip: ${tips[0].text}`);
  if (link) lines.push(`Details: ${link}`);
  return lines.join('\n');
}

function round(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}
