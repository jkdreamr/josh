// Truths and dares, mild for everyone, spicy mixed in when picked. Dares stay harmless, and a card that can't be
// done gets a free redraw. Any dare that involves another person ends with the same words: “if they say yes”.
// Typeset apostrophes and quotes (’ “ ”), since the card sets them big.
import type { Rng } from '../../kit/party-core.ts';

/** The words every dare that involves someone else ends with. */
export const CONSENT = 'if they say yes';

export const TRUTHS = {
  mild: [
    'What’s the most embarrassing thing in your search history?',
    'Who here do you text the most, and what about?',
    'Describe the worst gift you’ve ever gotten. Who gave it?',
    'Tell us the last lie you told, and who it was to.',
    'Which childish habit have you never grown out of?',
    'Who was your first crush, and do they know?',
    'Walk us through the worst date you’ve ever been on.',
    'Name something everyone loves that you secretly hate.',
    'What song do you play on repeat that you’d never admit to?',
    'How did you get your most embarrassing injury?',
    'When were you in the most trouble of your life?',
    'Who here gives the best advice, and did you take it?',
    'When did you last cry, and why?',
    'What’s a habit of yours nobody here knows about?',
    'What did people call you in school, and why?',
    'What’s something you’ve never told your parents?',
    'Who here would you swap lives with for a week?',
    'Confess the pettiest revenge you’ve ever taken.',
    'What’s your most unpopular opinion?',
    'Who here would you trust with your unlocked phone for an hour?',
    'Describe the cringiest thing you’ve ever posted.',
    'Be honest: what’s your record for days without a shower?',
    'What’s a rumor you started or helped spread?',
    'Which message in a group chat do you wish you could unsend?',
    'What was your first impression of someone here?',
    'How much money have you wasted on one dumb thing, and what was it?',
    'Who here would you take on a heist, and who would rat you out?',
    'What’s the meanest thing you’ve ever said to someone?',
    'What do you know about someone here that they don’t know you know?',
    'What did you do as a kid that you still feel guilty about?',
    'Who here would your parents adopt if they could?',
    'Tell us about the biggest thing you’ve ever gotten away with.',
    'Which job did you hate most, and how did it end?',
    'What’s the priciest thing you’ve broken, and did you own up?',
    'Who here would last longest without their phone, and who would crack first?',
    'Which thing your parents caught you doing still makes you cringe?',
    'What’s the weirdest thing you do when nobody else is home?',
    'What’s the most illegal thing you’ve done that you’ll admit to here?',
    'Have you ever faked being sick to get out of plans with us?',
    'What’s the dumbest argument you’ve refused to lose?',
  ],
  spicy: [
    'Who in this room would you date?',
    'What’s your biggest turn-off?',
    'Who was your worst kiss, and what went wrong?',
    'Have you ever had a crush on a friend’s partner?',
    'How far have you gone to get someone’s attention?',
    'Describe your type without mentioning looks.',
    'What was playing in the background of your most awkward hookup?',
    'Who here would you kiss tonight if nobody would ever find out?',
    'Who here is the best looking, not counting yourself?',
    'What’s your most embarrassing dating app story?',
    'What’s the worst text you’ve sent to someone you liked?',
    'Have you ever been in a situationship? Would you go back?',
    'Who here do you think is the best flirt?',
    'Which pickup line actually worked on you?',
    'When was your last first kiss, and how did it happen?',
    'What do you notice first about someone you’re into?',
    'Who’s your celebrity hall pass?',
    'What do you find attractive that most people don’t?',
    'What would your ex say is your worst habit?',
    'What’s your own biggest red flag?',
    'Have you ever said “I love you” without meaning it?',
    'What’s the pettiest reason you’ve stopped seeing someone?',
    'Who was the last person you made out with, and where?',
    'What dealbreaker have you ignored for someone hot?',
    'What’s your most scandalous hookup story, in one sentence?',
    'Have you ever hooked up with someone and regretted it by morning?',
    'What’s a romantic move you’re secretly dying to try?',
    'Which two people here would make the best couple?',
    'How long have you had a crush on someone without saying a word?',
    'Who was your most regrettable crush?',
    'Have you ever been caught in the act? Doing what?',
    'Who dumped you the worst, and how did they do it?',
    'Who in your contacts is saved under a fake name, and why?',
    'Who’s the last person you thought about kissing?',
    'How deep have you gone stalking an ex’s new partner?',
    'Who in your phone would you text right now if there were no consequences?',
    'How did your most awkward meet-the-parents go?',
    'When did you realize way too late that someone was flirting with you?',
    'Have you ever been someone’s secret? How did it end?',
    'What’s the most embarrassing thing you’ve done to look good for a date?',
  ],
  after: [
    'What’s your body count, and is that the real number?',
    'What’s a kink you’d try with the right person?',
    'Have you ever done something in bed just to say you’d done it?',
    'What’s the most embarrassing thing that’s happened to you in bed?',
    'How long have you gone without sex, and what ended the streak?',
    'Morning sex or midnight sex, and why?',
    'Who here would you sleep with, if you had to pick?',
    'What’s the most spontaneous hookup you’ve ever had?',
    'How fast have you gone from hello to bed?',
    'What’s the weirdest thing someone has asked you to do in bed?',
    'How many toys do you own? Round up.',
    'In bed, are you the one in charge or the one taking orders?',
    'Where’s the most public place you’ve sent a sext from?',
    'Rate your sex life out of ten right now.',
    'How many times have you done it in one day, at most?',
    'Which cheesy line actually got you into bed?',
    'Confess the strangest thing you’ve thought about during sex.',
    'What’s something you’ve done in bed you’ve never told your friends?',
    'Who was your best hookup? First name only.',
    'Where’s the riskiest place you’ve had sex?',
    'What’s a turn-on you’re a little embarrassed by?',
    'Describe your sex life as a movie title.',
    'What’s the most unusual thing you’ve brought into the bedroom?',
    'Have you ever sexted someone in this room?',
    'What’s your sexiest feature, in your own opinion?',
    'What’s the worst sex you’ve ever had, and did you go back for more?',
    'When did you last have sex, and where were you?',
    'Describe the boldest thing you’ve worn to bed for someone.',
    'Who here do you think is secretly the wildest in bed?',
    'What’s the hottest thing anyone has said to you in bed?',
    'What’s your type in bed, as opposed to your type on paper?',
    'What’s a sex rule you live by?',
    'Would you rather have great sex once a year or okay sex every day?',
    'Tell the person on your left the sexiest thing about them.',
    'What’s something you’re great at in bed? One word.',
    'What’s one thing a partner did in bed that you still think about?',
    'How much have you spent on a date that didn’t end the way you hoped?',
    'Have you ever hooked up with someone purely for their looks?',
    'Have you ever been so nervous before a hookup that you almost bailed?',
    'What happened after dark on your wildest vacation?',
  ],
} as const;

export const DARES = {
  mild: [
    'Do an impression of someone here until someone guesses who.',
    'Tell the story of how you got here tonight in an accent the group picks.',
    'Show the group the last photo you took of food.',
    'Sing the chorus of a song the group picks.',
    'Speak only in questions until someone catches you slipping.',
    'Perform a dramatic monologue about the last thing you lost.',
    'Dance with no music for 30 seconds.',
    'Do a runway walk across the room and back.',
    'Let the group scroll your music app for 30 seconds and judge.',
    'Hold a plank while the group counts to 30, slowly.',
    'Tell a joke. If nobody laughs, take a sip.',
    'Hype up the person on your right like they’re about to win a title fight.',
    'Be the group’s cat for one minute. No words.',
    'Make up a commercial for the last thing you ate and perform it.',
    'Do the worm, or your best attempt at it.',
    'Explain the plot of a movie badly until someone guesses it.',
    'Let the group pick a nickname everyone has to call you tonight.',
    'Do live sports commentary on the next person’s turn.',
    'Show the group your screen time for this week.',
    'Freestyle rap about the person across from you.',
    'Sell the person on your left like an infomercial.',
    'Take everyone’s drink order like a waiter at a very fancy restaurant.',
    'Text the last person you called “I love you” with no context.',
    'Text the third person in your contacts a sincere compliment.',
    'Do ten squats while saying the alphabet backwards.',
    'Balance a spoon on your nose for ten seconds.',
    'Give a 30 second TED talk on a topic the group picks.',
    'Put an ice cube down your shirt and let it melt.',
    'Recreate a famous meme until the group guesses it.',
    'Let the person on your right style your hair, if they say yes.',
    'Eat a spoonful of a condiment the group picks. Allergies get a free redraw.',
    'Call someone and sing happy birthday. It can’t be their birthday.',
    'Whisper everything until someone else picks Dare.',
    'Act out your morning routine as an interpretive dance.',
    'Give everyone here an oddly specific compliment.',
    'Try to make the person on your left laugh in 30 seconds without touching them.',
    'Swap seats with someone and act like them for one minute, if they say yes.',
    'Show the group the last thing you bought online.',
    'Let the group pick your phone wallpaper for the rest of the night.',
    'Reenact the last argument you had, playing both sides.',
  ],
  spicy: [
    'Give the person on your left a 30 second shoulder rub, if they say yes.',
    'Give a toast to your love life so far.',
    'Give everyone in the room your best flirty wink.',
    'Slow dance with someone for 30 seconds, if they say yes.',
    'Whisper something flirty to the person on your right, if they say yes.',
    'Kiss someone here on the cheek, if they say yes.',
    'Let the group write your next dating app bio.',
    'Swap a piece of clothing with the person on your left, if they say yes.',
    'Serenade someone here with a song they pick, if they say yes.',
    'Flirt with an object in the room until someone laughs.',
    'Hold eye contact with someone for 30 seconds without laughing, if they say yes.',
    'Describe the best looking person here until someone guesses who.',
    'Tell your dating history as a movie trailer.',
    'Do your sexiest dance move for ten seconds.',
    'Give a 30 second speech on why you’d be a great date.',
    'Give someone here a hug that lasts a little too long, if they say yes.',
    'Act out your signature flirting move.',
    'Act out how you’d react if your celebrity crush walked in right now.',
    'Propose to someone here, down on one knee, if they say yes.',
    'Read the ingredients on a snack in your most seductive voice.',
    'Sit on someone’s lap for the next turn, if they say yes.',
    'Ask the whole room out on a group date, like you mean it.',
    'Hold hands with the person on your left for the next turn, if they say yes.',
    'Feed the person on your right a snack, slowly, if they say yes.',
    'Do a slow motion walk across the room like you’re in a music video.',
    'Narrate the room like a dating show host.',
    'Strike your best “just woke up like this” pose and hold it for ten seconds.',
    'Do ten seconds of a strip tease. Nothing comes off.',
    'Make up a love song about the person on your right and sing a verse, if they say yes.',
    'Practice your best kiss on the back of your own hand.',
    'Go on a 60 second speed date with someone here, if they say yes.',
    'Show the group your most flirty emoji combo and explain when you use it.',
    'Give your best “come here” look to someone here, if they say yes.',
    'Let the person on your right pick your next profile picture.',
    'Trade compliments with the person on your left until one of you blushes, if they say yes.',
    'Do your best impression of yourself flirting at 2am.',
    'Deliver a pickup line the group writes to someone you pick, if they say yes.',
    'Plan a first date out loud for two people here, if they say yes.',
    'Pick someone to be your fake date for the rest of the round, if they say yes.',
    'Let everyone guess your type out loud, then say who was closest.',
  ],
  after: [
    'Take a body shot off someone here, if they say yes.',
    'Spin a bottle and kiss whoever it points to, if they say yes.',
    'Lose one item of clothing. You pick, and shoes and accessories count.',
    'Do an impression of your own O face.',
    'Read your spiciest text out loud. You pick which one.',
    'Show the group your best move on a banana.',
    'Record a flirty voice note for the group and play it out loud.',
    'Give someone here a 15 second lap dance, if they say yes.',
    'Whisper a three word fantasy to the person on your left, if they say yes.',
    'Trace a heart on someone’s back with one finger, if they say yes.',
    'Seduce the person on your left like they’re your celebrity crush, if they say yes.',
    'Demonstrate taking off a bra one-handed. Use a jacket.',
    'Pass an ice cube to someone here without using your hands, if they say yes.',
    'Moan the alphabet until someone laughs.',
    'Invite the whole room to bed in your sexiest voice.',
    'Let someone here undo one of your buttons, if they say yes.',
    'Recreate a steamy movie scene the group picks with someone here, if they say yes.',
    'Act out a hookup going wrong, solo.',
    'Do five push-ups over someone lying on the floor, if they say yes.',
    'Build the sexiest outfit you can from things in this room and model it.',
    'Make out with your own reflection for ten seconds.',
    'Give the person on your right a slow, sultry compliment, if they say yes.',
    'Flirt with the person on your left using only food words, if they say yes.',
    'Draw a flirty pen tattoo on someone’s arm, if they say yes.',
    'Tell the room the hottest thing about yourself, then prove it.',
    'Hold someone here like a romance novel cover for ten seconds, if they say yes.',
    'Eat a strawberry or any snack like you’re in a perfume ad.',
    'Give the room a sultry weather forecast.',
    'Show everyone how you’d text a booty call, out loud, without sending it.',
    'Arm wrestle someone here for a sock, if they say yes.',
    'Roleplay a sexy job of the group’s choice for 30 seconds.',
    'Try to tie a knot in a cherry stem with your tongue.',
    'Pose for an imaginary spicy mirror selfie. Phone stays down.',
    'Set up a blind date between two objects in this room and narrate the morning after.',
    'Give the room a slow, dramatic reveal of one shoulder.',
    'Give someone here a dramatic dance dip, if they say yes.',
    'Do your best seductive impression of a cat.',
    'Play footsie with someone here for 20 seconds, if they say yes.',
    'Show the room how you’d answer the door for a date in a towel, fully dressed.',
    'Fan yourself dramatically and name who here makes you blush.',
  ],
} as const;

export type Kind = 'truth' | 'dare';
/** How hot the cards run. Spicy and After Dark are both 18+; a new device starts on Mild. */
export const SPICES = ['mild', 'spicy', 'after'] as const;
export type Spice = (typeof SPICES)[number];
export const DEFAULT_SPICE: Spice = 'mild';
export type Card = { kind: Kind; text: string; tier: Spice };

/**
 * The cards in play at a heat: Mild alone; Spicy shuffled in with Mild; After Dark shuffled in with Spicy, so the
 * top tier never waters down to party questions.
 */
export function cardsFor(kind: Kind, spice: Spice): Card[] {
  const set = kind === 'truth' ? TRUTHS : DARES;
  const tiers: readonly Spice[] = spice === 'after' ? ['spicy', 'after'] : spice === 'spicy' ? ['mild', 'spicy'] : ['mild'];
  return tiers.flatMap((tier) => set[tier].map((text) => ({ kind, text, tier })));
}

/**
 * The next card of a kind: one this session hasn't seen if any are left, and never the card just shown.
 * `seen` holds the text of every card shown so far and outlives a trip back to setup.
 */
export function drawFresh(cards: readonly Card[], seen: ReadonlySet<string>, current?: string, rng: Rng = Math.random): Card | undefined {
  const fresh = cards.filter((c) => !seen.has(c.text) && c.text !== current);
  const pool = fresh.length ? fresh : cards.filter((c) => c.text !== current);
  const from = pool.length ? pool : cards;
  return from[Math.floor(rng() * from.length)];
}

/** Notes a card as seen. Once every card of its kind has come up, they all go back in, except this one. */
export function markSeen(cards: readonly Card[], seen: Set<string>, text: string): void {
  seen.add(text);
  if (cards.every((c) => seen.has(c.text))) for (const c of cards) if (c.text !== text) seen.delete(c.text);
}

/** Whose turn is next, going around the circle. */
export const nextSeat = (seat: number, players: number) => (players > 0 ? (seat + 1) % players : 0);

/** What each player has done this session. */
export type Tally = { truth: number; dare: number; chicken: number };
export const EMPTY: Tally = { truth: 0, dare: 0, chicken: 0 };

export const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "2 truths, 1 dare, chickened out once", or '' before their first turn. */
export function recordLine(r: Tally): string {
  return [r.truth ? count(r.truth, 'truth') : '', r.dare ? count(r.dare, 'dare') : '', r.chicken ? `chickened out ${times(r.chicken)}` : ''].filter(Boolean).join(', ');
}

/** Whoever has the most of something this session (several on a tie), or null if nobody has any yet. */
export function most(records: Readonly<Record<string, Tally>>, names: readonly string[], key: keyof Tally): { names: string[]; n: number } | null {
  const n = Math.max(0, ...names.map((name) => records[name]?.[key] ?? 0));
  return n ? { names: names.filter((name) => (records[name]?.[key] ?? 0) === n), n } : null;
}
