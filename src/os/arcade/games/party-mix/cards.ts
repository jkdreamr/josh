// The Party Mix deck. {p1} and {p2} are filled with two different players from the roster.
// Level 1 plays at every intensity and level 2 joins at Party. Levels 3 (Wild) and 4 (After Dark) are 18+ and only
// deal when someone picks them: frank about sex, never graphic, and anything that involves another person
// waits for their yes. Sips stay between 1 and 3, and a few cards hand out water or a break instead.

export type CardType = 'challenge' | 'give' | 'everyone' | 'vote' | 'duel' | 'game' | 'rule' | 'wyr';
export type Level = 1 | 2 | 3 | 4;

export type Template = {
  type: CardType;
  level: Level;
  text: string;
  /** Would You Rather: the second option (text is the first). */
  or?: string;
  /** Rules: a short name for the active-rules strip, and the line on its Rule Over card. */
  label?: string;
  end?: string;
  /** Fewest players the card works with (votes and Give cards need a crowd). */
  min?: number;
  /** A rule the named player writes on the spot: the table shows a box to type it into. */
  write?: boolean;
};

/** What every card that brings another person into it says, word for word. */
export const CONSENT = 'if they say yes';

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
    '{p1}, show us the last meme you sent and who you sent it to. Refuse and drink 2.',
    '{p1}, read your latest search out loud, no context allowed. Refuse and drink 3.',
    '{p1}, do ten seconds of stand-up about this party. No laughs, drink 2.',
    "{p1}, call someone who isn't here and sing them happy birthday. It doesn't need to be their birthday. Refuse and drink 3.",
    "{p1}, tell us the worst gift you've ever received. If someone here gave it to you, they drink 2.",
    '{p1}, show us the last photo you took and explain it. Refuse and drink 2.',
  ],
  3: [
    "{p1}, rate your last kiss out of ten. The group decides if you're lying. Liars drink 2.",
    '{p1}, describe your type using only things in this room. Too obvious? Drink 2.',
    "{p1}, tell us the most public place you've hooked up. Refuse and drink 3.",
    '{p1}, read your spiciest text out loud. You pick which one. Refuse and drink 3.',
    '{p1}, read the next card in your sexiest voice. Break character and drink 2.',
    '{p1}, name your celebrity hall pass. Everyone who agrees drinks 1.',
    '{p1}, name your biggest turn-off in ten words or less. Go over and drink 2.',
    '{p1}, try your best pickup line on the person to your left, if they say yes. They laugh, they drink 1. They cringe, you drink 2.',
    "{p1}, tell us about the last time you got friend-zoned, or did the zoning. Refuse and drink 2.",
    '{p1}, show the group your best bedroom eyes for five seconds. Anyone laughs, they drink 1.',
  ],
  4: [
    '{p1}, show us your O face. Three full seconds, eyes open. Chicken out and drink 3.',
    "{p1}, demonstrate your best technique on a banana. Any fruit works. Refuse and drink 3.",
    '{p1}, take off one item of clothing. Shoes and jewelry count, swimwear is the floor. Or drink 3.',
    '{p1}, the group guesses your body count. Confirm it, deny it or drink 3.',
    '{p1}, sit on someone\'s lap until your name comes up again, if they say yes. Get up early and drink 2.',
    "{p1}, take a body shot off someone's collarbone, if they say yes. A sip of your own drink counts.",
    '{p1}, perform a flirty voicemail for the whole room, beep included. Hold back and drink 2.',
    "{p1}, tell us the strangest thing that has ever turned you on. Refuse and drink 3.",
    '{p1}, tell us about your most awkward morning after in 30 seconds, or drink 3.',
    '{p1}, whisper your favorite position to the person on your right, if they say yes. They rate it out of ten, out loud.',
    "{p1}, point to the spot in this place you'd most want to have sex. Explain your pick or drink 2.",
    "{p1}, name the kink you'd try if nobody here ever found out. Too late. Refuse and drink 3.",
    '{p1}, give someone a ten-second shoulder rub, if they say yes. They score it out of five. Under 3, drink 2.',
    '{p1}, sum up your sex life as a movie title. The group buys it, hand out 2. They laugh, drink 2.',
    "{p1}, give an empty chair a ten-second lap dance. Hold back and drink 2.",
    "{p1}, tell us your safe word, or the one you'd pick. Refuse and drink 2.",
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
    '{p1}, give 3 sips to the person most likely to have a secret OnlyFans. They get to name their price.',
    '{p1}, give 2 sips to whoever has had the most recent hookup. Wrong guess? You drink them.',
    "{p1}, give 2 sips to whoever you'd call for a wingman on a night like this. They have to accept.",
  ],
  4: [
    "{p1}, give 3 sips to whoever you'd pick for a one-night stand, if tonight were that kind of night. No explaining.",
    '{p1}, give 2 sips to whoever you think is loudest in bed. They get one word in their defense.',
    '{p1}, give 2 sips to the person most likely to own handcuffs, and not for work.',
    '{p1}, give 3 sips to whoever has the best story about getting walked in on. They owe us the story.',
    '{p1}, give 2 sips to whoever you think has the busiest nightstand drawer.',
    "{p1}, give 2 sips to the person you'd trust to plan a threesome. Logistics only.",
    '{p1}, give 2 sips to whoever would be best at dirty talk. They give us one clean sample.',
    '{p1}, give 2 sips to whoever has the best sex playlist, or should. They name the first song.',
    '{p1}, give 3 sips to whoever you would trust to pick your underwear for a date. They describe the pick.',
    '{p1}, give 2 sips to the person most likely to have a sex dream about someone here tonight. Names stay secret.',
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
    'Everyone who has made out in the back of a cab, drink 1.',
    'Everyone who has done a walk of shame, drink 1. Before 7 a.m., drink 2.',
    "Everyone who has slid into someone's DMs this year, drink 1.",
    'Everyone who has had a friend with benefits, drink 1.',
    'Everyone who has lied about their age on a dating app, drink 1.',
  ],
  4: [
    'Everyone who has had sex in a car, drink 1.',
    'Everyone who has ever sent a nude, drink 1. Nobody has to say who got it.',
    'Everyone who has had a one-night stand, drink 1.',
    'Everyone who has been walked in on, drink 1. By a roommate, drink 2.',
    'Everyone who has used a toy with a partner, drink 1.',
    'Everyone who has hooked up with a coworker, drink 1. Same team, drink 2.',
    'Everyone who has had a threesome, drink 1. No follow-up questions.',
    'Everyone who has faked it in bed, drink 1.',
    "Everyone who has hooked up with an ex after swearing they wouldn't, drink 1.",
    'Everyone who has tried roleplay, drink 1. Name the costume or drink 1 more.',
    'Everyone who has had sex outdoors, drink 1.',
    'Everyone wearing matching underwear right now, drink 1. Proof is optional.',
    "Everyone who has been someone's booty call, drink 1. Everyone who made the call, drink 1 too.",
    'Everyone who has played strip poker, drink 1. Lost, drink 2.',
    'Everyone who has cheated, or been the other person, drink 1. No details.',
    "Everyone who has said 'I love you' in bed and regretted it, drink 1.",
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
    "Who's most likely to have a secret OnlyFans? Point on three. Most fingers drinks 2 and names the price.",
  ],
  4: [
    'Who has the highest body count? Point on three. Most fingers drinks 2. Nobody has to confirm.',
    "Who's the kinkiest person here? Point on three. Most fingers drinks 2. Denials are noted.",
    'Who would be best at phone sex? Point on three. Most fingers gives out 2.',
    'Who has had sex in the strangest place? Point on three. Most fingers drinks 2 and tells us where.',
    "Who's the best in bed, going on pure vibes? Point on three. Most fingers gives out 3.",
    'Who has a friend with benefits on speed dial? Point on three. Most fingers drinks 2.',
    'Who would last the longest without sex? Point on three. Most fingers gives out 2.',
    'Who would be too embarrassed to buy anything in a sex shop? Point on three. Most fingers drinks 2.',
    "Who's the worst at sexting? Point on three. Most fingers drinks 2 and gives us their best line.",
    'Who would cheat at strip poker? Point on three. Most fingers drinks 2.',
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
    '{p1} vs {p2}: slow dance for ten seconds, eyes locked, if they say yes. First to laugh drinks 2.',
    '{p1} vs {p2}: more exes drinks 2. Honor system.',
    '{p1} vs {p2}: worst date story. The group picks the worse date, and its owner drinks 2.',
    '{p1} vs {p2}: whoever kissed someone more recently drinks 2. Honor system.',
  ],
  4: [
    "{p1} vs {p2}: whisper something filthy in each other's ear, if they say yes. First to blush drinks 2.",
    '{p1} vs {p2}: higher body count drinks 2. Honor system, no numbers needed.',
    '{p1} vs {p2}: best fake moan. The group judges. Loser drinks 2.',
    "{p1} vs {p2}: {p1} sits on {p2}'s lap, if they say yes. Staring contest. First to laugh drinks 2.",
    '{p1} vs {p2}: pitch the group a kink in 15 seconds, like a startup. Weaker pitch drinks 2.',
    "{p1} vs {p2}: guess each other's biggest turn-on. Whoever is further off drinks 2.",
    '{p1} vs {p2}: whoever had sex more recently drinks 2. Honor system.',
    '{p1} vs {p2}: ten-second strip tease, shoes and socks only. The group judges. Loser drinks 2.',
    '{p1} vs {p2}: name sex positions back and forth. First to blank or make one up drinks 2.',
  ],
};

const GAME: ByLevel<string> = {
  1: [
    'Categories, {p1} starts: things in a gas station. First to blank drinks 2.',
    'Categories, {p1} starts: excuses for leaving a party early. First to blank drinks 2.',
    'Categories, {p1} starts: famous dogs. First to blank drinks 2.',
    "Rhyme time, {p1} starts with 'cake'. Go around the circle. First to blank or repeat drinks 2.",
    "Word association, {p1} starts with 'beach'. Hesitate and drink 1.",
    "Count around the circle, {p1} starts at 1. Say 'buzz' for any number with a 7 or divisible by 7. Mess up, drink 2.",
    'Two truths and a lie, {p1} goes. Everyone who guesses wrong drinks 1.',
    'One-word story, {p1} starts. Go around until someone laughs or stalls. They drink 2.',
    '{p1}, think of a famous person. Everyone gets one yes or no question. Nobody gets it, hand out 3. Someone does, drink 2.',
    'Food from A to Z around the circle, {p1} starts with A. Stall and drink 2.',
    'Never have I ever, {p1} starts. Everyone holds up three fingers. First to put all three down drinks 2.',
    "Celebrity chain, {p1} starts. Each name starts with the last one's surname initial. Stall and drink 2.",
  ],
  2: [
    'Hot seat, {p1}. Everyone asks you one question. Refuse to answer and drink 2.',
    "Categories, {p1} starts: things you shouldn't say at a funeral. First to blank drinks 2.",
    'Accents on, {p1} picks the accent. Everyone talks in it for a minute. First to break drinks 1.',
    "Most likely to, {p1} starts: finish 'most likely to' about the person on your left. Weakest one drinks 2.",
  ],
  3: [
    'Categories, {p1} starts: worst things to say in bed. First to blank drinks 2.',
    'Spicy never have I ever, {p1} starts. Three fingers up. First to put all three down drinks 2.',
    'Truth or drink, {p1} first. The group asks one spicy question. Answer it or drink 2, then pass it left.',
    'Stage names around the circle, {p1} starts: your favorite cocktail plus the last thing you ate. Best one hands out 3.',
  ],
  4: [
    'Never have I ever, After Dark edition. {p1} starts, bedroom topics only. Three fingers up. First to fold drinks 2.',
    'Two truths and a lie, sex life edition. {p1} goes first. Wrong guesses drink 1.',
    'Smash, marry, ghost, {p1} starts: name three celebrities for the person on your left. Hesitate and drink 2.',
    "Fill in the blank, {p1} starts: 'The hottest thing someone can do is...' Weakest answer drinks 2.",
    'Categories, {p1} starts: places people have hooked up. First to blank drinks 2.',
    'Categories, {p1} starts: things you could whisper in bed. First to blank or blush drinks 2.',
    'Hot takes about sex, {p1} starts. One each, around the circle. The group boos the worst one, and its owner drinks 2.',
  ],
};

type RuleText = { text: string; label: string; end: string; write?: boolean };

const RULE: ByLevel<RuleText> = {
  1: [
    { text: "Nobody says anyone's name, except when reading a card. Slip up, drink 1.", label: 'No names', end: 'Names are back. Call people whatever you like.' },
    { text: 'Drink with your left hand only. Use your right and drink 1.', label: 'Left hand only', end: 'Both hands are allowed again.' },
    { text: 'Pinkies out. Anyone caught drinking without a pinky up drinks 1 more.', label: 'Pinkies out', end: 'Pinkies can come down.' },
    { text: '{p1} is the Question Master. Answer any question they ask and you drink 1.', label: '{p1} is Question Master', end: '{p1} is no longer the Question Master. Answer freely.' },
    { text: '{p1} is the Thumb Master. When they rest a thumb on the table, everyone copies. Last one drinks 1.', label: '{p1} is Thumb Master', end: '{p1} loses the thumb. Rest easy.' },
    { text: "Start every sentence with 'With all due respect'. Reading a card doesn't count. Forget and drink 1.", label: 'With all due respect', end: 'You may now speak with no respect at all.' },
    { text: '{p1} and {p2} are drinking buddies. When one drinks, so does the other.', label: '{p1} and {p2} drink together', end: '{p1} and {p2} are on their own again.' },
    { text: '{p1} makes up a rule right now. It lasts until the Rule Over card.', label: "{p1}'s rule", end: "{p1}'s rule is over.", write: true },
    { text: "Clink glasses and say 'cheers' before every drink. Forget and drink 1.", label: 'Cheers first', end: 'No more clinking required.' },
  ],
  2: [
    { text: 'Phones face down, except the one with these cards. Touch yours when no card asked you to and drink 2.', label: 'Phones face down', end: 'Phones are back. Go check them.' },
    { text: 'No swearing. Every slip is a sip.', label: 'No swearing', end: 'Swear freely.' },
    { text: "Questions only. Make a statement and drink 1. Reading a card doesn't count.", label: 'Questions only', end: "Statements are back. Isn't that nice?" },
    { text: '{p1} has snake eyes. Meet their eyes and drink 1.', label: '{p1} has snake eyes', end: "{p1}'s snake eyes wear off." },
  ],
  3: [
    { text: 'Before you drink, tell anyone here one thing you find hot about them.', label: 'Compliment, then drink', end: 'Compliments are optional again.' },
    { text: "{p1}, hold {p2}'s hand until the Rule Over card, if they say yes. Let go and you both drink 1.", label: '{p1} and {p2} hold hands', end: '{p1} and {p2} can let go.' },
    { text: 'Talk like a late-night radio host, card reading included. Break character and drink 1.', label: 'Late-night radio voice', end: 'Normal voices. The mood is ruined.' },
    { text: "Pet names only: babe, darling, sweet cheeks. Use a real name and drink 1. Reading a card doesn't count.", label: 'Pet names only', end: 'Real names are back, babe.' },
  ],
  4: [
    { text: "{p1} sits on {p2}'s lap until the Rule Over card, if they say yes. When one drinks, so does the other.", label: "{p1} is on {p2}'s lap", end: '{p1} can stand up. Stretch it out.' },
    { text: 'Every sip ends with a satisfied moan. Forget and drink 1.', label: 'Moan after every sip', end: 'Sip in silence again.' },
    { text: 'Before you drink, confess one turn-on. No repeats. Blank and drink 1.', label: 'Turn-on before you drink', end: 'Your secrets are safe again. For now.' },
    { text: "{p1} is the Seducer. Anyone who meets {p1}'s eyes has to wink back. Miss it and drink 1.", label: '{p1} is the Seducer', end: '{p1} retires as the Seducer.' },
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
    ['Have your parents read your sexts', "Read your parents' sexts"],
    ['Only flirt by quoting Shrek', 'Only flirt in puns'],
    ['Wake up next to your ex', 'Wake up next to your boss'],
    ['Go on a blind date your mom set up', 'Go on a blind date your ex set up'],
    ['Hook up with your celebrity crush once', 'Date a solid seven for a whole year'],
    ['Slow dance with your celebrity crush for one song', 'Get one flirty text from them a year, forever'],
    ['Have a hickey at your job interview', 'Have lipstick on your collar at a funeral'],
  ],
  4: [
    ["Moan your ex's name by accident", "Moan your boss's name by accident"],
    ['Only have sex with the lights off', 'Only have sex with every light on'],
    ['Get walked in on by your roommate', 'Get walked in on by your landlord'],
    ['Give up sex for a year', 'Give up your phone for a year'],
    ['Have your partner find your toy drawer', 'Have your mom find your toy drawer'],
    ['Sext with autocorrect stuck on', 'Sext only in emojis'],
    ['Have a really loud neighbor', 'Be the really loud neighbor'],
    ['Laugh at the worst moment in bed', 'Say the wrong name in bed'],
    ['Hook up in a plane bathroom', 'Hook up in a changing room'],
    ['Have every hookup narrated by a nature documentary voice', 'Have every hookup scored by a panel of judges'],
    ['Find out your partner has a secret OnlyFans', 'Find out your best friend subscribes to it'],
    ['Accidentally send a nude to your work group chat', 'Accidentally send your browser history to your boss'],
    ['Date someone who is terrible at dirty talk', 'Date someone who never says a word in bed'],
  ],
};

const LEVEL_IDS: readonly Level[] = [1, 2, 3, 4];
const lines = (type: CardType, by: ByLevel<string>, min?: number): Template[] =>
  LEVEL_IDS.flatMap((level) => by[level].map((text) => (min ? { type, level, text, min } : { type, level, text })));

export const CARDS: readonly Template[] = [
  ...lines('challenge', CHALLENGE),
  // Giving sips with one other player in the room isn't a choice.
  ...lines('give', GIVE, 3),
  ...lines('everyone', EVERYONE),
  ...lines('vote', VOTE, 3),
  ...lines('duel', DUEL),
  ...lines('game', GAME),
  ...LEVEL_IDS.flatMap((level) => RULE[level].map((r): Template => ({ type: 'rule', level, ...r }))),
  ...LEVEL_IDS.flatMap((level) => WYR[level].map(([text, or]): Template => ({ type: 'wyr', level, text, or }))),
];

/**
 * Topics a deck deals at most `max` times (once unless it says otherwise): a second card on the same topic reads
 * like a repeat. A card belongs to every topic whose pattern matches any of its text.
 */
export const THEMES: readonly { id: string; test: RegExp; max?: number }[] = [
  { id: 'kiss', test: /\bkiss(ed|es|ing)?\b|\bmade out\b/i, max: 2 },
  { id: 'best kisser', test: /\bbest kisser\b/i },
  { id: 'flirt', test: /\bflirt/i },
  { id: 'pickup line', test: /\bpickup line/i },
  { id: 'dating', test: /\bdat(e|es|ing)\b|\bwingman\b|\bfriend-zoned\b/i, max: 2 },
  { id: 'ex', test: /\bex(es|'s)?\b/i, max: 2 },
  { id: 'hookup', test: /\bhook(ed|ing)? up\b|\bhookups?\b|\bone-night stand\b|\bgoing home with\b|\bbooty call\b/i, max: 3 },
  { id: 'places', test: /\bin a car\b|\boutdoors\b|\bstrangest place\b|\bmost public place\b|\bspot in this place\b|\bplane bathroom\b|\bplaces people\b/i, max: 2 },
  { id: 'how recent', test: /\bmore recently\b|\bmost recent\b/i },
  { id: 'going without', test: /\bwithout sex\b|\bgive up sex\b/i },
  { id: 'body count', test: /\bbody count\b/i },
  { id: 'in bed', test: /\bin bed\b|\bbedroom\b/i, max: 2 },
  { id: 'nudes', test: /\bnudes?\b|\bskinny dipping\b/i },
  { id: 'sexting', test: /\bsext/i },
  { id: 'walked in on', test: /\bwalked in on\b/i },
  { id: 'morning after', test: /\bwalk of shame\b|\bmorning after\b/i },
  { id: 'toys', test: /\btoys?\b|\bnightstand\b|\bhandcuffs\b|\bsex shop\b/i },
  { id: 'kink', test: /\bkink|\bsafe word\b/i },
  { id: 'turn-ons', test: /\bturn(ed)?[- ](on|off)s?\b|\bturned you on\b/i },
  { id: 'threesome', test: /\bthreesome/i },
  { id: 'onlyfans', test: /\bonlyfans\b/i },
  { id: 'friends with benefits', test: /\bbenefits\b/i },
  { id: 'lap', test: /\blap\b/i },
  { id: 'strip', test: /\bstrip\b|\bitem of clothing\b/i },
  { id: 'underwear', test: /\bunderwear\b|\bhickey\b/i },
  { id: 'moan', test: /\bmoan|\bo face\b/i },
  { id: 'sexy voice', test: /\bsexiest voice\b|\bradio host\b|\bflirty voicemail\b|\bdirty talk\b|\bfilthy\b|\bwhisper/i },
  { id: 'positions', test: /\bpositions?\b/i },
  { id: 'sex dream', test: /\bsex dream\b/i },
  { id: 'cheating', test: /\bcheat(ed|ing)?\b|\bother person\b/i },
  { id: 'coworker', test: /\bcoworker\b|\bwork group\b|\bboss\b|\bjob\b/i },
  { id: 'crush', test: /\bhall pass\b|\bcrush\b|\bcelebrities\b/i },
  { id: 'slow dance', test: /\bslow dance\b|\bdance\b/i },
  { id: 'never have i ever', test: /\bnever have i ever\b/i },
  { id: 'two truths', test: /\btwo truths\b/i },
  { id: 'categories', test: /^Categories\b/, max: 2 },
  { id: 'texts', test: /\btext(s|ed|er|ing)?\b/i, max: 2 },
  { id: 'wedding', test: /\bwedding\b/i },
  { id: 'battery', test: /\bbattery\b/i },
  { id: 'accent', test: /\baccents?\b/i },
  { id: 'impression', test: /\bimpressions?\b/i },
  { id: 'compliment', test: /\bcompliment|\bhot about\b/i },
  { id: 'search history', test: /\bsearch\b|\bbrowser history\b/i },
  { id: 'reality show', test: /\breality\b/i },
  { id: 'unread', test: /\bunread\b/i },
  { id: 'photos', test: /\block screen\b|\bphoto\b|\bmeme\b/i },
  { id: 'thumb', test: /\bthumb/i },
  { id: 'eye contact', test: /\beyes\b/i },
];

/** The topics a card belongs to. */
export function themesOf(t: Pick<Template, 'text' | 'or' | 'label' | 'end'>): string[] {
  const all = [t.text, t.or, t.label, t.end].filter(Boolean).join(' \n ');
  return THEMES.filter((th) => th.test.test(all)).map((th) => th.id);
}
