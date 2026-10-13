// Each prompt finishes "Who's most likely to ...". Lowercase start, no question mark.
// Deck ids stay stable (party) so a saved deck choice survives a relabel.
import { listNames } from '../../kit/party-core.ts';

export const DECKS = {
  classic: {
    label: 'Classic',
    prompts: [
      'cry at a dog food commercial',
      'reply to a text three weeks later with just "haha"',
      'have over 200 unread texts right now',
      'get lost in their own neighborhood',
      'adopt a pet without telling their roommate',
      'laugh at the worst possible moment',
      'die first in a horror movie because they went to check on a noise',
      'survive a zombie apocalypse by hiding in a Costco',
      'win a reality show by being the villain',
      'trip over absolutely nothing',
      'be late to their own wedding',
      'talk their way out of a speeding ticket',
      'still be wearing that hoodie in ten years',
      'have 50 tabs open right now',
      'be everyone\'s unpaid therapist',
      'plan a group trip in a color coded spreadsheet',
      'fall for a scam email from a prince',
      'spend the whole party with the host\'s dog',
      'know all the gossip before anyone else',
      'start a podcast nobody listens to',
      'win the lottery and lose the ticket',
      'spend rent money on concert tickets',
      'forget where they parked and report the car stolen',
      'go viral for something embarrassing',
      'move to another country on a whim',
      'eat something off the floor and defend it',
      'send a voice memo longer than a podcast episode',
      'say "five minutes away" while still in bed',
      'give amazing advice and never follow it',
      'be the reason we can\'t go back to that restaurant',
      'become best friends with their Uber driver',
      'sleep through a fire alarm',
      'get into an argument with a referee at a kids\' game',
      'hold a grudge for over ten years',
      'read the last page of a book first',
      'pretend they\'ve seen a movie for a whole conversation',
      'cancel plans and then post from somewhere else',
      'ask the waiter what\'s good and order something else',
      'tell the same story twice in one night',
      'give a houseplant a name and a birthday',
    ],
  },
  party: {
    label: 'Tonight',
    prompts: [
      'be the last one standing tonight',
      'lose their phone tonight',
      'drunk text an ex tonight',
      'order food at 3am and have no memory of it',
      'fall asleep first tonight',
      'make friends with the bouncer',
      'cry in the club',
      'start a sing-along nobody else knows the words to',
      'give a speech nobody asked for',
      'spill a drink on the host',
      'take their shoes off at a party',
      'take over the music without asking',
      'leave without saying goodbye to anyone',
      'lie about how many drinks they\'ve had',
      'be the most hungover tomorrow and blame the food',
      'swear off drinking tomorrow and break it by Friday',
      'convince everyone to go out after',
      'end up in a pool with their clothes on',
      'buy a round for total strangers',
      'lose their voice screaming the lyrics',
      'start a conga line',
      'get everyone kicked out',
      'end up on everyone\'s story tonight',
      'go home with a new best friend',
      'show up an hour early and end up helping set up',
      'wake up tomorrow with a mystery bruise',
      'challenge a stranger to a dance-off',
      'get lost on the way to the bathroom',
      'cheat at a drinking game',
      'have no memory of tonight',
      'be found asleep in the bathtub',
      'start a deep conversation in the kitchen at 2am',
      'tell a stranger their whole life story',
      'call a ride and make it wait 20 minutes',
      'text the group chat "where is everyone" from the wrong bar',
      'eat all the snacks before anyone else arrives',
      'bring a plus one nobody knew was coming',
      'say "one more drink" and mean six',
      'post a blurry photo with a long caption tonight',
      'befriend the neighbors who came to complain about the noise',
    ],
  },
  future: {
    label: 'Future',
    prompts: [
      'get married first',
      'have a midlife crisis at 30',
      'move to a farm and post about it constantly',
      'run for mayor of a small town and win',
      'end up on a dating show',
      'retire at 35',
      'write a memoir nobody asked for',
      'found a startup and call it disruptive',
      'buy a boat they can\'t afford',
      'be the coolest grandparent',
      'get famous for something weird',
      'go to space and complain about the food',
      'forget to thank us in their Oscar speech',
      'end up in a true crime documentary as a witness',
      'marry someone they met online',
      'have the most kids',
      'live in a van on purpose',
      'open a restaurant that only serves breakfast',
      'become a TikTok star at 70',
      'still be in this group chat at 80',
      'become a billionaire and still split the bill to the cent',
      'name their kid something we all have to pretend is normal',
      'invent something everyone uses',
      'move abroad for six months and come back with an accent',
      'go through five diets in one year',
      'get their first tattoo at 60',
      'marry their high school sweetheart',
      'end up running the company they complain about',
      'move back in with their parents at 35',
      'become a gym influencer',
      'get rich from something completely stupid',
      'have a themed wedding we all have to dress up for',
      'own a house before 30',
      'become a wine snob',
      'adopt ten cats',
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
      'get arrested for something dumb',
      'fight a goose and lose',
      'join a cult by accident',
      'get banned from an all you can eat buffet',
      'adopt a raccoon',
      'get kicked off a plane',
      'try to pet a wild animal',
      'eat a bug on a dare',
      'kill a group chat with one message',
      'argue with a self-checkout machine',
      'start beef with a stranger online',
      'confidently give a tourist wrong directions',
      'crash a wedding and give a toast',
      'buy something cursed online',
      'set off the smoke alarm making toast',
      'get lost in an IKEA for hours',
      'fall for a very obvious prank',
      'accidentally text the person they\'re talking about',
      'climb something they can\'t get down from',
      'call one of us for bail money',
      'start a fight at a kid\'s birthday party',
      'accidentally join a protest',
      'get their arm stuck in a vending machine',
      'talk their way backstage at a concert',
      'steal a traffic cone as a souvenir',
      'get a tattoo with a typo',
      'leave a one star review out of spite',
      'lick something to win an argument',
      'end up in the background of a news report',
      'get escorted out of a museum',
      'fight a stranger over a parking spot',
      'be on a first name basis with the local police',
      'trade their phone for a burrito at 3am',
      'send money to the wrong person and never ask for it back',
      'try to fix something and set it on fire',
      'pick a fight with a mall Santa',
      'get stuck in a bathroom stall and call for help',
      'turn a wedding toast into a roast',
      'sneak a pet into a hotel',
      'lose something expensive in a bet',
    ],
  },
  spicy: {
    label: 'Spicy 18+',
    prompts: [
      'have a secret crush in this room',
      'hook up with an ex this year',
      'kiss someone tonight',
      'have the most dating app matches',
      'send a risky text tonight',
      'have a secret relationship',
      'date two people at once',
      'get caught sneaking someone out',
      'fall for their best friend',
      'slide into a celebrity\'s DMs',
      'have a vacation fling',
      'flirt their way out of trouble',
      'marry the first person they date',
      'have the most exes',
      'text an ex "I miss you" tonight',
      'have a crush on a friend\'s sibling',
      'ghost someone after one date',
      'make the first move',
      'fall in love in a week',
      'have their celebrity hall pass ready',
      'date someone twice their age',
      'hook up at a wedding',
      'get a hickey at 30',
      'flirt with the bartender for free drinks',
      'have a secret dating app profile right now',
      'go home with someone they met tonight',
      'kiss a stranger at midnight on New Year\'s',
      'be the best kisser here',
      'have a wild story they\'ve never told us',
      'fall for someone in a band',
      'be someone\'s secret',
      'date a coworker and keep it quiet',
      'get walked in on',
      'flirt with someone\'s parent',
      'send a flirty text to the wrong person',
      'be a terrible kisser and not know it',
      'have a dating profile that\'s mostly lies',
      'fall in love with a stranger on a plane',
      'end up with someone they swore they\'d never date',
      'leave a date through the bathroom window',
    ],
  },
} as const satisfies Record<string, { label: string; prompts: readonly string[] }>;

export type DeckId = keyof typeof DECKS;
export const DECK_IDS = Object.keys(DECKS) as DeckId[];
/** Every deck but the 18+ one starts switched on. */
export const DEFAULT_DECKS: DeckId[] = DECK_IDS.filter((d) => d !== 'spicy');

export type Prompt = { deck: DeckId; text: string };

export function promptsFor(decks: readonly DeckId[]): Prompt[] {
  const ids = decks.filter((d) => DECK_IDS.includes(d));
  return (ids.length ? ids : DEFAULT_DECKS).flatMap((deck) => DECKS[deck].prompts.map((text) => ({ deck, text })));
}

export function parseDecks(raw: unknown): DeckId[] {
  const ids = Array.isArray(raw) ? DECK_IDS.filter((id) => raw.includes(id)) : [];
  return ids.length ? ids : DEFAULT_DECKS;
}

/** One title the room handed out: the prompt and who got the most fingers. */
export type Title = { text: string; name: string };

/** Records a title, replacing any earlier pick for the same prompt; `name: null` takes it back. */
export function crown(titles: readonly Title[], text: string, name: string | null): Title[] {
  const rest = titles.filter((t) => t.text !== text);
  return name ? [...rest, { text, name }] : rest;
}

export type Standing = { name: string; seat: number; count: number; latest?: string };

/** Everyone on the roster with their titles, most first; ties keep seating order. */
export function standings(players: readonly string[], titles: readonly Title[]): Standing[] {
  return players
    .map((name, seat) => {
      const mine = titles.filter((t) => t.name === name);
      return { name, seat, count: mine.length, latest: mine[mine.length - 1]?.text };
    })
    .sort((a, b) => b.count - a.count || a.seat - b.seat);
}

/** "Sam leads with 3", "Sam and Jo are tied on 2", or null before anyone has a title. */
export function leadLine(table: readonly Standing[]): string | null {
  const top = table[0]?.count ?? 0;
  if (!top) return null;
  const leaders = table.filter((s) => s.count === top).map((s) => s.name);
  if (leaders.length === 1) return `${leaders[0]} leads with ${top}`;
  if (leaders.length > 3) return `${leaders.length} people tied on ${top}`;
  return `${listNames(leaders)} are tied on ${top}`;
}
