// The Party Mix deck. {p1} and {p2} are filled with two different players from the roster.
// Level 1 plays at every intensity, level 2 joins at Party, level 3 (18+, suggestive, never explicit) only at Wild.
// Sips stay between 1 and 3, and a few cards hand out water or a break instead.

export type CardType = 'challenge' | 'give' | 'everyone' | 'vote' | 'duel' | 'game' | 'rule' | 'wyr';
export type Level = 1 | 2 | 3;

export type Template = {
  type: CardType;
  level: Level;
  text: string;
  /** Would You Rather: the second option (text is the first). */
  or?: string;
  /** Rules: a short name for the active-rules strip, and the line on its Rule Over card. */
  label?: string;
  end?: string;
  /** Fewest players the card works with (votes need a crowd). */
  min?: number;
};

type ByLevel<T> = Record<Level, readonly T[]>;

const CHALLENGE: ByLevel<string> = {
  1: [
    '{p1}, name five pasta shapes in ten seconds or drink 2.',
    '{p1}, guess the time without checking. More than 15 minutes off, drink 2.',
    '{p1}, say the months of the year backwards, fast. Stumble and drink 2.',
    '{p1}, name a country for every letter of your first name. Miss one, drink 2.',
    '{p1}, do an impression of someone in this room. If nobody guesses who in one try, drink 2.',
    '{p1}, keep a straight face for 15 seconds while everyone tries to crack you. Smile and drink 2.',
    '{p1}, sell us the drink in your hand like a late-night infomercial. Nobody buys it? Drink 1.',
    '{p1}, hum a song until someone names it. Nobody gets it in 15 seconds, drink 2.',
    "{p1}, describe your morning for 20 seconds without saying 'um' or 'like'. Slip and drink 2.",
    '{p1}, explain the plot of your favorite movie in one breath. Run out of air, drink 2.',
    "{p1}, show us your most useless talent. Can't think of one? Drink 2.",
    '{p1}, name all five Spice Girls by their Spice name. Miss one, drink 2.',
    '{p1}, narrate the next 20 seconds of this party like a nature documentary. No laughs, drink 1.',
    '{p1}, the group picks an accent for you. Keep it until your name comes up again, or drink 1.',
    '{p1}, do a runway walk to the door and back. The group scores it out of ten. Under 7, drink 2.',
    "{p1}, you're on a break. No drinking until your name comes up again.",
    "{p1}, compliment the person on your left without using 'nice', 'funny' or 'kind'. Stall and drink 1.",
    '{p1}, name a song for every color of the rainbow. Miss one, drink 2.',
  ],
  2: [
    '{p1}, read the last text you sent out loud, or drink 3.',
    "{p1}, show us yesterday's screen time. Over five hours, drink 2.",
    '{p1}, open your camera roll at a random spot and show the group, or drink 3.',
    '{p1}, read your latest search out loud, no context allowed. Refuse and drink 3.',
    '{p1}, do ten seconds of stand-up about this party. No laughs, drink 2.',
    "{p1}, call someone who isn't here and sing them happy birthday. It doesn't need to be their birthday. Refuse and drink 3.",
    "{p1}, tell us the worst gift you've ever received. If someone here gave it to you, they drink 2.",
    '{p1}, show us the last photo you took and explain it. Refuse and drink 2.',
  ],
  3: [
    "{p1}, rate your last kiss out of ten. The group decides if you're lying. Liars drink 2.",
    '{p1}, describe your type using only things in this room. Too obvious? Drink 2.',
    '{p1}, give the person on your left your best pickup line. If they laugh, they drink 1. If they cringe, you drink 2.',
    '{p1}, tell us about your worst date in 30 seconds, or drink 3.',
    '{p1}, show the group your last flirty text, or drink 3.',
    '{p1}, name your celebrity hall pass. Everyone who agrees drinks 1.',
  ],
};

const GIVE: ByLevel<string> = {
  1: [
    "{p1}, give 3 sips to the person you'd call to get you out of jail.",
    '{p1}, give 2 sips to whoever has the oldest phone here. Evidence required.',
    '{p1}, give 2 sips to the last person who arrived.',
    "{p1}, give 2 sips to the person you've known the longest, and tell us how you met.",
    '{p1}, give 2 sips to whoever you want next to you in a zombie apocalypse. Explain your pick.',
    '{p1}, give 2 sips to the person whose music taste you trust. They pick the next song.',
    '{p1}, give 2 sips to whoever gives the worst advice. Share an example.',
    '{p1}, pour someone a glass of water. They drink it before the next card.',
    '{p1}, give 2 sips to whoever will be the last one standing tonight.',
    '{p1}, give 2 sips to whoever takes the longest to reply to your texts.',
    '{p1}, hand out 3 sips however you like. Splitting them up is allowed, but cowardly.',
    '{p1}, give 2 sips to the best cook here. They have to name their signature dish.',
    '{p1}, give 2 sips to whoever is sitting closest to you. Proximity has consequences.',
    '{p1}, give 2 sips to the person most likely to cry at a wedding. Even their own.',
  ],
  2: [
    "{p1}, give 3 sips to the person you'd least trust with your unlocked phone.",
    "{p1}, give 2 sips to whoever you'd call first for gossip.",
    '{p1}, give 2 sips to the person most likely to text their ex tonight.',
    '{p1}, give 2 sips to whoever has the most embarrassing story here. They owe us the story.',
    '{p1}, give 2 sips to the worst driver here. Evidence is optional.',
    '{p1}, give 3 sips to the most convincing liar here. They have to deny it.',
    "{p1}, give 2 sips to whoever you'd want as your wingman tonight. They have to accept the job.",
  ],
  3: [
    '{p1}, give 2 sips to the biggest flirt here.',
    "{p1}, give 3 sips to whoever has the wildest past. They don't have to confirm anything.",
    '{p1}, give 2 sips to whoever you think is the best kisser here, based on vibes alone.',
    '{p1}, give 2 sips to whoever has the most questionable dating history. Details welcome.',
  ],
};

const EVERYONE: ByLevel<string> = {
  1: [
    'Everyone who has been to a festival, drink 1.',
    'Everyone under 20% battery, drink 1.',
    "Everyone who has texted 'on my way' while still at home, drink 1.",
    'Last person to touch their nose drinks 2.',
    'Water round. Everyone drinks some water before the next card. Yes, you too.',
    'Everyone with an R in their name, drink 1.',
    'Everyone who has slept through their stop on a bus or train, drink 1.',
    'Everyone with over 1,000 unread emails, drink 1. Over 10,000, drink 2.',
    'Everyone switch seats. Last one to sit down drinks 2.',
    'Snack break. Nobody drinks until someone eats something.',
    'Everyone who has cried at an animated movie, drink 1 and name the movie.',
    'Everyone with a celebrity encounter story, drink 1. Best story hands out 2.',
    'Everyone who has been banned from anything, drink 1 and tell us what.',
    'Everyone point at the ceiling. Last hand up drinks 2.',
    "Everyone who said 'just one drink' tonight, drink 1.",
    'Everyone who has killed a houseplant this year, drink 1.',
    'The youngest person here gives out 2 sips. The oldest gets a glass of water.',
  ],
  2: [
    'Everyone who has lied on a resume, drink 1.',
    'Everyone with a screenshot that could end a friendship, drink 1.',
    'Everyone who has been kicked out of a bar, drink 1 and tell us why.',
    "Everyone who has ghosted someone, drink 1. Everyone who's been ghosted, drink 1 too.",
    'Everyone who checked their phone in the last five minutes, drink 1.',
    'Everyone who has faked a phone call to avoid someone, drink 1.',
    "Everyone who has looked up an ex's new partner online, drink 1.",
  ],
  3: [
    'Everyone who has kissed someone in this room, drink 1. No names needed.',
    'Everyone who has used a dating app this month, drink 1.',
    'Everyone who has sent a text tonight they might regret, drink 1.',
    "Everyone who has had a crush on a friend's sibling, drink 1.",
    'Everyone who has gone skinny dipping, drink 1.',
    'Everyone who has hooked up at a wedding, drink 1.',
    'Everyone who has kissed two people in one night, drink 1.',
  ],
};

const VOTE: ByLevel<string> = {
  1: [
    'On three, point at the worst texter here. Most fingers drinks 2.',
    'Who survives longest in a horror movie? Point on three. Most fingers gives out 2.',
    'Who would be the worst roommate? Point on three. Most fingers drinks 2, then gets to defend themselves.',
    'Who would win a fight with a goose? Point on three. Most fingers gives out 2.',
    "Who's most likely to go viral for something stupid? Point on three. Most fingers drinks 2.",
    'Who gives the best hugs? Point on three. Most fingers gives out 2 and has to prove it.',
    'Who cries first on a reality show? Point on three. Most fingers drinks 2.',
    'Who would accidentally join a cult? Point on three. Most fingers drinks 2.',
    "Who's secretly the most competitive? Point on three. Most fingers drinks 2.",
    'Who would last the longest without their phone? Point on three. Most fingers gives out 2.',
    'Who would ruin a surprise party? Point on three. Most fingers drinks 2.',
  ],
  2: [
    'Who has the most questionable search history? Point on three. Most fingers drinks 2.',
    "Who's most likely to get us kicked out of somewhere? Point on three. Most fingers drinks 2.",
    "Who's the worst drunk texter? Point on three. Most fingers drinks 2.",
    'Who leaves first tonight? Point on three. Most fingers drinks 2, or stays to prove us wrong.',
    'Who has the best fake laugh? Point on three. Most fingers drinks 2, then lets us hear it.',
    'Who would make the worst boss? Point on three. Most fingers drinks 2.',
    'Who would survive a week on a reality dating show? Point on three. Most fingers gives out 2.',
  ],
  3: [
    "Who's the biggest flirt here? Point on three. Most fingers drinks 2.",
    'Who has the most exes? Point on three. Most fingers drinks 2. No need to count out loud.',
    "Who's the best kisser here, on vibes alone? Point on three. Most fingers gives out 2.",
    "Who's going home with someone tonight? Point on three. Most fingers drinks 2.",
    'Who has the best bedroom eyes? Point on three. Most fingers gives out 2.',
  ],
};

const DUEL: ByLevel<string> = {
  1: [
    '{p1} vs {p2}: thumb war. Loser drinks 2.',
    '{p1} vs {p2}: staring contest. First to blink drinks 2.',
    '{p1} vs {p2}: rock, paper, scissors, best of three. Loser drinks 2.',
    '{p1} vs {p2}: lower phone battery drinks 2.',
    '{p1} vs {p2}: make the other one laugh. First to crack drinks 2.',
    "{p1} vs {p2}: say 'unique New York' five times fast. The group picks the worse one, who drinks 2.",
    '{p1} vs {p2}: name car brands back and forth. First to blank or repeat drinks 2.',
    '{p1} vs {p2}: stand on one leg, eyes closed. First to wobble drinks 2.',
    '{p1} vs {p2}: race to find a photo of a dog on your phone. Slower one drinks 2.',
    "{p1} and {p2}: each tell us how you met, one at a time. Stories don't match? Both drink 1.",
    '{p1} vs {p2}: whoever woke up later today drinks 2.',
    '{p1} vs {p2}: rap battle, four lines each. The group cheers for a winner. Loser drinks 2.',
    '{p1} vs {p2}: arm wrestle. Loser drinks 2. Winner has to stay humble.',
    '{p1} vs {p2}: compliment battle. Take turns until one of you stalls. They drink 2.',
  ],
  2: [
    '{p1} vs {p2}: more unread texts drinks 2.',
    "{p1} vs {p2}: swap phones and read each other's last sent text out loud. Refuse and drink 3.",
    '{p1} vs {p2}: do impressions of each other. The group picks the better one. Loser drinks 2.',
    '{p1} vs {p2}: older lock screen photo drinks 2.',
    "{p1} vs {p2}: guess each other's birthday. Whoever is further off drinks 2.",
  ],
  3: [
    '{p1} vs {p2}: best pickup line, delivered to the group. Worse line drinks 2.',
    '{p1} vs {p2}: slow dance for ten seconds with full eye contact. First to laugh drinks 2.',
    '{p1} vs {p2}: more exes drinks 2. Honor system.',
    '{p1} vs {p2}: worst date story. The group picks the worse date, and its owner drinks 2.',
  ],
};

const GAME: ByLevel<string> = {
  1: [
    'Categories, {p1} starts: things in a gas station. First to blank drinks 2.',
    'Categories, {p1} starts: famous dogs. First to blank drinks 2.',
    'Categories, {p1} starts: things in a junk drawer. First to blank drinks 2.',
    'Categories, {p1} starts: excuses for leaving a party early. First to blank drinks 2.',
    "Rhyme time, {p1} starts with 'cake'. Go around the circle. First to blank or repeat drinks 2.",
    "Word association, {p1} starts with 'beach'. Hesitate and drink 1.",
    "Count around the circle, {p1} starts at 1. Say 'buzz' for any number with a 7 or divisible by 7. Mess up, drink 2.",
    'Two truths and a lie, {p1} goes. Everyone who guesses wrong drinks 1.',
    'One-word story, {p1} starts. Go around until someone laughs or stalls. They drink 2.',
    '{p1}, think of a famous person. Everyone gets one yes or no question. Nobody gets it, hand out 3. Someone does, drink 2.',
    'Food from A to Z around the circle, {p1} starts with A. Stall and drink 2.',
  ],
  2: [
    'Hot seat, {p1}. Everyone asks you one question. Refuse to answer and drink 2.',
    "Categories, {p1} starts: words that sound rude but aren't. First to blank drinks 2.",
    "Categories, {p1} starts: things you shouldn't say at a funeral. First to blank drinks 2.",
    'Accents on, {p1} picks the accent. Everyone talks in it for a minute. First to break drinks 1.',
  ],
  3: [
    'Categories, {p1} starts: worst things to say in bed. First to blank drinks 2.',
    'Categories, {p1} starts: worst places to hook up. First to blank drinks 2.',
  ],
};

type RuleText = { text: string; label: string; end: string };

const RULE: ByLevel<RuleText> = {
  1: [
    { text: "Nobody can say anyone's name. Slip up, drink 1.", label: 'No names', end: 'Names are back. Call people whatever you like.' },
    { text: 'Drink with your left hand only. Use your right and drink 1.', label: 'Left hand only', end: 'Both hands are allowed again.' },
    { text: 'Pinkies out. Anyone caught drinking without a pinky up drinks 1 more.', label: 'Pinkies out', end: 'Pinkies can come down.' },
    { text: '{p1} is the Question Master. Answer any question they ask and you drink 1.', label: '{p1} is Question Master', end: '{p1} is no longer the Question Master. Answer freely.' },
    { text: '{p1} is the Thumb Master. When they rest a thumb on the table, everyone copies. Last one drinks 1.', label: '{p1} is Thumb Master', end: '{p1} loses the thumb. Rest easy.' },
    { text: "Start every sentence with 'With all due respect'. Forget and drink 1.", label: 'With all due respect', end: 'You may now speak with no respect at all.' },
    { text: '{p1} and {p2} are drinking buddies. When one drinks, so does the other.', label: '{p1} and {p2} drink together', end: '{p1} and {p2} are on their own again.' },
    { text: '{p1} makes up a rule right now. It lasts until the Rule Over card.', label: "{p1}'s rule", end: "{p1}'s rule is over." },
    { text: "Clink glasses and say 'cheers' before every drink. Forget and drink 1.", label: 'Cheers first', end: 'No more clinking required.' },
  ],
  2: [
    { text: "Phones face down. Pick yours up when a card didn't ask you to, and drink 2.", label: 'Phones face down', end: 'Phones are back. Go check them.' },
    { text: 'No swearing. Every slip is a sip.', label: 'No swearing', end: 'Swear freely.' },
    { text: 'Questions only. Make a statement and drink 1.', label: 'Questions only', end: "Statements are back. Isn't that nice?" },
    { text: '{p1} has snake eyes. Meet their eyes and drink 1.', label: '{p1} has snake eyes', end: "{p1}'s snake eyes wear off." },
  ],
  3: [
    { text: 'Before you drink, tell the person on your left one thing you find attractive about them.', label: 'Compliment, then drink', end: 'Compliments are optional again.' },
    { text: '{p1} and {p2} hold hands. Let go and you both drink 1.', label: '{p1} and {p2} hold hands', end: '{p1} and {p2} can let go.' },
  ],
};

const WYR: ByLevel<readonly [string, string]> = {
  1: [
    ['Have a theme song play every time you walk in', 'Have a laugh track after everything you say'],
    ['Always be ten minutes late', 'Always be forty minutes early'],
    ['Fight one very angry raccoon', 'Argue with a toddler for an hour'],
    ['Give up cheese forever', 'Give up coffee forever'],
    ["Talk to animals, but they're all rude", "Understand babies, but they're all boring"],
    ['Wear damp socks forever', 'Have a pebble in your shoe forever'],
    ['Lose your phone for a week', 'Lose your voice for a week'],
    ['Only eat breakfast food', 'Never eat breakfast food again'],
    ['Have your thoughts shown as subtitles', 'Narrate your whole life out loud'],
    ['Know every language', 'Play every instrument'],
    ['Sneeze every time you lie', 'Hiccup every time someone lies to you'],
    ['Be the funniest person in every room', 'Be the smartest person in every room'],
    ['Have free flights for life', 'Never pay for food again'],
    ['Have a phone with no internet', 'Have internet with no phone'],
  ],
  2: [
    ['Have your search history read at your funeral', 'Have your texts read at your wedding'],
    ["Accidentally like your ex's photo from 2016", 'Send your boss a voice note meant for your best friend'],
    ['Get stuck in an elevator with your boss', 'Get stuck in an elevator with your ex'],
    ['Have your mom read your group chat', "Have your group chat read your mom's texts"],
    ['Date someone who chews loudly', 'Date someone who claps when the plane lands'],
    ['Go viral for a terrible dance', 'Go viral for a terrible opinion'],
    ['Never drink again', 'Only drink warm beer forever'],
  ],
  3: [
    ['Kiss someone with bad breath', "Kiss someone who's bad at kissing"],
    ['Have your ex plan your wedding', 'Have your parents run your dating profile'],
    ['Only flirt by quoting Shrek', 'Only flirt in puns'],
    ['Date someone who laughs at everything', 'Date someone who laughs at nothing'],
    ['Wake up next to your ex', 'Wake up next to your boss'],
    ['Go on a blind date your mom set up', 'Go on a blind date your ex set up'],
  ],
};

const LEVEL_IDS: readonly Level[] = [1, 2, 3];
const lines = (type: CardType, by: ByLevel<string>, min?: number): Template[] =>
  LEVEL_IDS.flatMap((level) => by[level].map((text) => (min ? { type, level, text, min } : { type, level, text })));

export const CARDS: readonly Template[] = [
  ...lines('challenge', CHALLENGE),
  ...lines('give', GIVE),
  ...lines('everyone', EVERYONE),
  ...lines('vote', VOTE, 3),
  ...lines('duel', DUEL),
  ...lines('game', GAME),
  ...LEVEL_IDS.flatMap((level) => RULE[level].map((r): Template => ({ type: 'rule', level, ...r }))),
  ...LEVEL_IDS.flatMap((level) => WYR[level].map(([text, or]): Template => ({ type: 'wyr', level, text, or }))),
];
