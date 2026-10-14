// Each prompt finishes “Who’s most likely to …”. Lowercase start, no question mark, and typeset apostrophes and
// quotes (’ “ ”), since the card sets them big. Deck ids stay stable (party) so a saved deck choice survives a relabel.
import { listNames, type Rng } from '../../kit/party-core.ts';

export const DECKS = {
  classic: {
    label: 'Classic',
    prompts: [
      'cry at a dog food commercial',
      'reply to a text three weeks later with just “haha”',
      'have over 200 unread texts right now',
      'use GPS to get home from the corner store',
      'adopt a pet without telling their roommate',
      'laugh at their own joke before the punchline',
      'die first in a horror movie because they went to check on a noise',
      'survive a zombie apocalypse by hiding in a Costco',
      'win a reality show by being the villain',
      'trip over absolutely nothing',
      'be late to their own wedding',
      'get a free upgrade just by asking',
      'still be wearing that hoodie in ten years',
      'have 50 tabs open right now',
      'be everyone’s unpaid therapist',
      'plan a group trip in a color coded spreadsheet',
      'click the scam text about a missed package',
      'spend the whole party with the host’s dog',
      'know all the gossip before anyone else',
      'start a podcast nobody listens to',
      'win the lottery and lose the ticket',
      'spend rent money on concert tickets',
      'forget where they parked and report the car stolen',
      'go viral for something embarrassing',
      'move to another country on a whim',
      'eat something off the floor and defend it',
      'have a nemesis at their local grocery store',
      'turn a quick errand into a four hour adventure',
      'give amazing advice and never follow it',
      'be the reason we can’t go back to that restaurant',
      'become best friends with their Uber driver',
      'sleep through a fire alarm',
      'get into an argument with a referee at a kids’ game',
      'hold a grudge for over ten years',
      'read the last page of a book first',
      'pretend they’ve seen a movie for a whole conversation',
      'rate every meal out loud like a food critic',
      'ask the waiter what’s good and order something else',
      'tell the same story twice in one night',
      'give a houseplant a name and a birthday',
    ],
  },
  party: {
    label: 'Tonight',
    prompts: [
      'be the last one standing tonight',
      'lose their phone tonight',
      'fall asleep first tonight',
      'start a sing-along nobody else knows the words to',
      'spill a drink on the host',
      'be the first to take their shoes off',
      'take over the music without asking',
      'be the most hungover tomorrow and blame the food',
      'convince everyone to go somewhere else after',
      'start a conga line',
      'end up on everyone’s story tonight',
      'get lost on the way to the bathroom',
      'cheat at a drinking game',
      'start a deep conversation in the kitchen',
      'tell a stranger their whole life story',
      'call a ride and make it wait 20 minutes',
      'bring a plus one nobody knew was coming',
      'post a blurry photo with a long caption tonight',
      'befriend the neighbors who came to complain about the noise',
      'lose their voice screaming the lyrics',
      'challenge someone here to a dance-off',
      'eat the last slice and not ask',
      'make friends with every single person here',
      'turn a simple question into a two hour debate',
      'order pizza for the whole room at midnight',
      'say “I’m heading home” and still be here an hour later',
      'be the one doing dishes at the end of the night',
      'take a phone call in the loudest corner of the room',
      'play the same song five times tonight',
      'already be planning the next party',
      'make a toast before the night is over',
      'steal someone’s seat the second they get up',
      'rearrange the furniture to make a dance floor',
      'change into pajamas while everyone’s still here',
      'be the one who remembers every detail tomorrow',
      'have the best story from tonight',
      'end up sitting on the kitchen counter',
      'have a snack hidden in their bag right now',
      'drink water all night and still be the loudest',
      'be the one everyone wants to sit next to',
    ],
  },
  future: {
    label: 'Future',
    prompts: [
      'get married first',
      'have a midlife crisis at 30',
      'move to a farm and post about it constantly',
      'run for mayor of a small town and win',
      'become the neighbor who calls the city about everything',
      'retire at 35',
      'write a memoir and name names',
      'found a startup and call it disruptive',
      'buy a boat they can’t afford',
      'be the coolest grandparent',
      'end up with their own Wikipedia page',
      'go to space and complain about the food',
      'forget to thank us in their Oscar speech',
      'end up in a true crime documentary as a witness',
      'marry someone they met online',
      'be the parent who embarrasses their kids on purpose',
      'live in a van on purpose',
      'open a restaurant that only serves breakfast',
      'become a TikTok star at 70',
      'still be in this group chat at 80',
      'become a billionaire and still split the bill to the cent',
      'name their kid something we all have to pretend is normal',
      'invent something everyone uses',
      'move abroad for six months and come back with an accent',
      'take up a new hobby every month and finish none',
      'go back to college at 60 and join a frat',
      'marry their high school sweetheart',
      'end up running the company they complain about',
      'move back in with their parents at 35',
      'be the one who organizes the 20 year reunion',
      'get rich from something completely stupid',
      'have a themed wedding we all have to dress up for',
      'own a house before 30',
      'become a wine snob',
      'get a parrot that outlives them',
      'live to 100 out of spite',
      'host every family holiday forever',
      'go on a game show and lose in the first round',
      'write a self help book',
      'quit their job to become a DJ',
    ],
  },
  chaos: {
    label: 'Chaos',
    prompts: [
      'call one of us for bail money',
      'fight a goose and lose',
      'join a cult by accident',
      'get banned from an all you can eat buffet',
      'adopt a raccoon',
      'get kicked off a plane',
      'eat a bug on a dare',
      'kill a group chat with one message',
      'argue with a self-checkout machine',
      'confidently give a tourist wrong directions',
      'buy something cursed online',
      'set off the smoke alarm making toast',
      'get lost in an IKEA for hours',
      'fall for a very obvious prank',
      'climb something they can’t get down from',
      'accidentally join a protest',
      'get their arm stuck in a vending machine',
      'talk their way backstage at a concert',
      'steal a traffic cone as a souvenir',
      'get a tattoo with a typo',
      'leave a one star review out of spite',
      'end up in the background of a news report',
      'get escorted out of a museum',
      'trade their phone for a burrito at 3am',
      'send money to the wrong person and never ask for it back',
      'try to fix something and set it on fire',
      'turn a wedding toast into a roast',
      'sneak a pet into a hotel',
      'lose something expensive in a bet',
      'get into a bidding war over something they don’t want',
      'accidentally go live on Instagram',
      'start a rumor about themselves to see how far it goes',
      'lock themselves out twice in one day',
      'show up to a black tie event in sneakers',
      'accidentally lead a flash mob',
      'win an eating contest they entered as a joke',
      'start a GoFundMe for something ridiculous',
      'accidentally buy a car',
      'challenge a pro athlete to a race',
      'move into a place they’ve never seen in person',
    ],
  },
  spicy: {
    label: 'Spicy 18+',
    prompts: [
      'kiss someone tonight',
      'get flirty after one drink',
      'send a risky text tonight',
      'make the first move',
      'go home with someone they met tonight',
      'have a wild story they’ve never told us',
      'hook up with someone the day they match',
      'fall in love with a stranger on a plane',
      'end up with someone they swore they’d never date',
      'leave a date through the bathroom window',
      'stay friends with every single ex',
      'get a phone number tonight',
      'date someone just for their accent',
      'hook up with their personal trainer',
      'have a bedroom playlist ready to go',
      'go on a date and leave with the waiter’s number',
      'admit to a crush on a cartoon character',
      'post a thirst trap right after a breakup',
      'get caught making out at a family barbecue',
      'have a hookup story for every city they’ve visited',
      'end up marrying someone in this room',
      'kiss and tell the whole group chat',
      'end up in a love triangle',
      'have a nightstand drawer nobody should open',
      'go on three dates in one day',
      'lose their swimsuit in the ocean',
      'turn every photo booth into a make-out booth',
      'make out in an elevator and get caught when the doors open',
      'flirt by roasting someone',
      'get a tattoo of a partner’s name',
      'leave their underwear at someone’s place',
      'book a hotel room just in case',
      'get married in Vegas by accident',
      'end up with a sugar daddy or sugar mommy',
      'flirt with the whole bar and go home alone',
      'invite an ex to their wedding',
      'match with their boss on a dating app',
      'have a nickname from an ex they won’t explain',
      'have a secret admirer in this room',
      'be the first to suggest spin the bottle',
    ],
  },
  after: {
    label: 'After Dark 18+',
    prompts: [
      'have a secret OnlyFans',
      'say yes to a threesome before the question is finished',
      'buy a costume “for a party” that never sees a party',
      'make a move during a couples massage',
      'have a kink nobody would guess',
      'try anything once in the bedroom',
      'get frisky in a fitting room',
      'have a better sex life at 80 than any of us now',
      'end up dating an adult film star',
      'get kicked out of a hotel for the noise',
      'hook up in a tent at a music festival',
      'turn a hookup into a marriage',
      'hook up with someone just to see their apartment',
      'have a secret second phone for hookups',
      'send a sext ruined by autocorrect',
      'fall asleep during sex',
      'propose in bed',
      'have a thing for feet',
      'christen every room of a new place',
      'have a tattoo only their partners have seen',
      'hook up with two people from the same friend group',
      'be the reason a dating app changed its rules',
      'get a sex toy confiscated at airport security',
      'have a safe word that’s just the name of a snack',
      'have their smart speaker chime in at the worst possible moment',
      'get caught on a doorbell camera at 6am',
      'keep a ranked list of everyone they’ve slept with',
      'end up in a polycule',
      'write erotic fan fiction under a pen name',
      'turn game night into strip poker',
      'run into a coworker at a nude beach',
      'own a sex swing and use it as a coat rack',
      'be great at dirty talk and terrible at small talk',
      'get a sex toy as a wedding gift',
      'take a tantric workshop and make it everyone’s problem',
      'hook up with someone who has their exact name',
      'have a love life their therapist takes notes on',
      'answer their mom’s call mid-hookup',
      'make a sex joke in a job interview',
      'have a sex bucket list with deadlines',
    ],
  },
} as const satisfies Record<string, { label: string; prompts: readonly string[] }>;

export type DeckId = keyof typeof DECKS;
export const DECK_IDS = Object.keys(DECKS) as DeckId[];
/** The 18+ decks: Spicy, and After Dark above it. Both start switched off. */
export const ADULT_DECKS: readonly DeckId[] = ['spicy', 'after'];
export const DEFAULT_DECKS: DeckId[] = DECK_IDS.filter((d) => !ADULT_DECKS.includes(d));

export type Prompt = { deck: DeckId; text: string };

export function promptsFor(decks: readonly DeckId[]): Prompt[] {
  const ids = decks.filter((d) => DECK_IDS.includes(d));
  return (ids.length ? ids : DEFAULT_DECKS).flatMap((deck) => DECKS[deck].prompts.map((text) => ({ deck, text })));
}

export function parseDecks(raw: unknown): DeckId[] {
  const ids = Array.isArray(raw) ? DECK_IDS.filter((id) => raw.includes(id)) : [];
  return ids.length ? ids : DEFAULT_DECKS;
}

/**
 * The next card to deal: one this session hasn't seen if any are left, and never the card on screen.
 * `seen` holds the text of every card shown so far and outlives a trip back to setup.
 */
export function drawFresh(items: readonly Prompt[], seen: ReadonlySet<string>, current?: string, rng: Rng = Math.random): Prompt | undefined {
  const fresh = items.filter((p) => !seen.has(p.text) && p.text !== current);
  const pool = fresh.length ? fresh : items.filter((p) => p.text !== current);
  const from = pool.length ? pool : items;
  return from[Math.floor(rng() * from.length)];
}

/** Notes a card as seen. Once every card in play has come up, they all go back in, except the one on screen. */
export function markSeen(items: readonly Prompt[], seen: Set<string>, text: string): void {
  seen.add(text);
  if (items.every((p) => seen.has(p.text))) for (const p of items) if (p.text !== text) seen.delete(p.text);
}

/** Most sips one person takes on a card under A Sip Per Finger. */
export const SIP_CAP = 3;

/** One title the room handed out: the prompt and whoever got the most fingers (several on a tie). */
export type Title = { text: string; names: string[] };

/** Records the title for a card, replacing any earlier pick for it; no names takes it back. */
export function crown(titles: readonly Title[], text: string, names: readonly string[]): Title[] {
  const rest = titles.filter((t) => t.text !== text);
  return names.length ? [...rest, { text, names: [...names] }] : rest;
}

/** Tapping a name on the Point screen: adds or removes them, keeping seating order. */
export function togglePick(players: readonly string[], picked: readonly string[], name: string): string[] {
  return players.filter((p) => (p === name ? !picked.includes(p) : picked.includes(p)));
}

/** "Sam takes the title", "Sam and Jo share the title", "5 people share the title". */
export function titleLine(names: readonly string[]): string {
  if (names.length === 1) return `${names[0]} takes the title`;
  if (names.length > 3) return `${names.length} people share the title`;
  return `${listNames(names)} share the title`;
}

export type Standing = { name: string; seat: number; count: number; latest?: string };

/** Everyone on the roster with their titles (a shared title counts for each of them), most first; ties keep seating order. */
export function standings(players: readonly string[], titles: readonly Title[]): Standing[] {
  return players
    .map((name, seat) => {
      const mine = titles.filter((t) => t.names.includes(name));
      return { name, seat, count: mine.length, latest: mine[mine.length - 1]?.text };
    })
    .sort((a, b) => b.count - a.count || a.seat - b.seat);
}

/** Who leads and with how many, or null before anyone has a title. */
export function leaders(table: readonly Standing[]): { names: string[]; count: number } | null {
  const count = table[0]?.count ?? 0;
  return count ? { names: table.filter((s) => s.count === count).map((s) => s.name), count } : null;
}

/** "Sam leads with 3", "Tied on 2: Sam and Jo", "4 people tied on 1", or null before anyone has a title. */
export function leadLine(table: readonly Standing[]): string | null {
  const lead = leaders(table);
  if (!lead) return null;
  if (lead.names.length === 1) return `${lead.names[0]} leads with ${lead.count}`;
  if (lead.names.length > 3) return `${lead.names.length} people tied on ${lead.count}`;
  return `Tied on ${lead.count}: ${listNames(lead.names)}`;
}
