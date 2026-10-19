// What the commentator can say. Every line here is recorded ahead of time (scripts/grand-prix-commentary.py renders
// them with a neural voice into public/sounds/grand-prix/commentary/, one file per variant), and commentary.ts picks
// and strings them together during a race. Lines about the player never say "you" or name them, so they work alone
// in a solo race and after "Player one" or "Player two" in split screen. Changing a line means rendering it again.
import { DRIVERS } from './teams.ts';

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth'];
const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** A driver's surname, the way the commentator says it. */
export const surname = (name: string) => name.split(/\.\s*/).pop() ?? name;
/** The clip key for a driver's name. */
export const nameKey = (name: string) => `name-${surname(name).toLowerCase().replace(/[^a-z0-9]/g, '')}`;

/** The corners the commentator knows, keyed by the names the track gives them. */
export const CORNERS: Record<string, string> = {
  'Variante del Rettifilo': 'rettifilo',
  'Curva Biassono': 'grande',
  'Variante della Roggia': 'roggia',
  'Curva di Lesmo 1': 'lesmo',
  'Curva di Lesmo 2': 'lesmo',
  'Variante Ascari': 'ascari',
  'Curva Alboreto': 'parabolica',
};

const lines: Record<string, string[]> = {
  // before the start
  'intro-race': [
    'Welcome to Monza, the temple of speed. Twenty cars on the grid, and the grandstands are packed.',
    'Good afternoon from Monza, where the straights are long, the braking zones are brutal, and the crowd is ready.',
    'We are set for a race at Monza. Low downforce, huge top speeds, and very little room for error.',
    'Here we go then, Monza. The fastest circuit on the calendar, and every one of these drivers wants this one.',
    'Welcome back to Monza. The engines are warm, the tyres are on, and the formation lap is done.',
  ],
  'intro-trial': [
    'A clear track at Monza. Just one car, the stopwatch, and the fastest circuit in the world.',
    'Time trial at Monza. No traffic, no excuses. It is all about the perfect lap.',
    'The circuit is all yours. Hit the braking points, use every inch of road, and let us see a time.',
  ],
  lights: ['Here come the lights.', 'Lights coming on now.', 'Five red lights.', 'Here we go.'],
  go: [
    'And it is lights out, and away we go!',
    'Lights out, and they are away!',
    'Away they go at Monza!',
    'Lights out, and the race is on!',
  ],
  // the run to the first corner
  'start-good': [
    'What a start! Places gained before the first chicane!',
    'A rocket of a getaway! Up the order already!',
    'That is a brilliant launch, cars passed off the line!',
  ],
  'start-bad': [
    'Oh, a slow getaway there, places lost off the line.',
    'Bogged down at the start! That is going to need some work.',
    'Not the start that was needed, swallowed up by the pack.',
  ],
  'start-hold': [
    'A clean start, and position held into the first chicane.',
    'Tidy getaway, holding station for now.',
    'Good start, nothing gained, nothing lost.',
  ],
  'start-lead': ['A perfect getaway from pole, and the lead is safe into the first chicane.', 'Away cleanly from the front, and still leading.', 'Lights to flag is the plan, and so far so good. Still in front.'],
  'turn1-clean': [
    'Through the first chicane, and everybody gets through cleanly!',
    'Into the Rettifilo, side by side, and they all survive it!',
    'The first chicane is done, and the whole field is still in one piece.',
  ],
  'turn1-contact': [
    'Contact at the first chicane! There is always trouble here on the opening lap!',
    'Oh, bodywork rubbing into turn one! It is chaos at the Rettifilo!',
  ],
  // overtakes by the player (then where they are now)
  pass: [
    'What a move!',
    'Brilliant overtake!',
    'Up the inside, and through!',
    'Beautifully done!',
    'Round the outside! Stunning!',
    'Late on the brakes, and it sticks!',
    'Into the gap, and gone!',
  ],
  past: ['And that is past', 'Straight past', 'A clean pass on', 'Through, and ahead of'],
  lead: [
    'And that is the lead! Into first place!',
    'Into the lead of the race! What a moment!',
    'Leading the Grand Prix! The crowd is on its feet!',
  ],
  // the player losing a place
  'passed-by': ['Oh, and that is a place gone.', 'Passed, and nothing could be done about it.', 'Oh, that is a place lost there.', 'Caught out, and overtaken.'],
  'gets-by': ['gets by!', 'goes through!', 'makes the move stick!', 'is past!'],
  'lost-lead': ['And the lead is gone!', 'Oh, the lead has slipped away!', 'And that is the end of the lead, for now.'],
  // battles
  pressure: ['is under real pressure now.', 'has a car right on the gearbox.', 'can see a car filling the mirrors.', 'is going to have to defend.'],
  'closing-in': [
    'The gap to the car ahead is coming down, lap after lap.',
    'Reeling in the car in front now, this is getting interesting.',
    'Catching hand over fist! The gap is under a second!',
  ],
  defending: [
    'Under attack now, a car right in the mirrors.',
    'Having to defend here, the car behind is all over the back.',
    'Holding on, but the pressure is building from behind.',
  ],
  'breathing-space': ['A bit of breathing space now, the gap behind is growing.', 'Pulling clear of the car behind. Nicely done.', 'That gap is opening up. Some room to breathe.'],
  'drs-attack': ['DRS open, and this could be the chance!', 'The flap is open, can it get done before the braking zone?', 'DRS open, closing right up!'],
  tow: ['Right in the slipstream, picking up a huge tow.', 'This is Monza, the slipstream is everything. Look at that tow.', 'Tucked in behind, gaining on the straight.'],
  // incidents
  spin: ['Oh! It is a spin! Round it goes!', 'Spun it! That is going to cost a lot of time!', 'Oh no! Facing the wrong way!', 'Around it goes! Gather it up!'],
  wall: ['Into the barrier! That is a heavy one!', 'Oh, a big hit on the wall there!', 'Contact with the barrier! That will hurt!'],
  contact: ['Contact! Wheel to wheel, and they touch!', 'They have touched! Bits of carbon everywhere!', 'Oh, a bump there! Hard racing!'],
  lockup: ['Big lock up! Smoke from the front tyres!', 'Locked the fronts! Overshooting the corner!', 'Oh, a lock up there, too much speed into the corner.'],
  wide: ['Off the track there, the lap is gone.', 'Wide, and over the white line.', 'All four wheels off, that is a lap deleted.'],
  'wide-rettifilo': ['Straight on at the Rettifilo, cutting the chicane!', 'Missed the first chicane completely!'],
  'wide-grande': ['Running wide through the Curva Grande!', 'Too much speed in the Curva Grande, out wide!'],
  'wide-roggia': ['Over the kerbs at the Roggia, too much speed!', 'Straight on at the Roggia chicane!'],
  'wide-lesmo': ['Running wide at Lesmo, onto the grass!', 'Ran out of road at Lesmo!'],
  'wide-ascari': ['Out wide through Ascari, over the kerbs!', 'Running wide at Ascari, that will cost time!'],
  'wide-parabolica': ['Running wide at the Parabolica, onto the run off!', 'Ran out of road at the Parabolica!'],
  'final-warning': ['The stewards are watching. That is a final warning for track limits.', 'Final warning now. One more and it is a penalty.'],
  penalty: ['And that is a five second penalty for track limits. That could be expensive.', 'Five seconds added. The stewards have run out of patience.'],
  reset: ['Back on the circuit, but that has cost a lot of time.', 'Rejoining the track. The damage is done to this lap.'],
  // speed, tyres and the car
  'top-speed': ['Over three hundred and thirty kilometres an hour on the speed trap!', 'Look at the speed! Three hundred and thirty plus down this straight!', 'Flat out! Monza is all about this kind of speed.'],
  'tyres-cold': ['The tyres are still cold. Careful in these first few corners.', 'Not much temperature in those tyres yet, the grip will come.'],
  'tyres-hot': ['Those rear tyres are getting hot now. Every slide costs grip.', 'The tyres are overheating, some smoother laps would help.'],
  // laps
  halfway: ['We are at half distance.', 'Halfway through the race now.'],
  'final-lap': ['Final lap!', 'Here comes the final lap!', 'One lap to go!', 'The last lap is underway!'],
  // the race elsewhere (after a name)
  'takes-lead': ['takes the lead of the race!', 'is the new leader!', 'goes to the front!'],
  leads: ['still leads the way.', 'controlling the race from the front.', 'is out in front, looking very comfortable.', 'leads the field.'],
  'fastest-to': ['Fastest lap of the race goes to', 'The quickest lap so far belongs to', 'The purple lap belongs to'],
  'has-spun': ['has spun! Trouble out there!', 'is off the road! Gathering it up!'],
  'takes-flag': ['takes the chequered flag!', 'wins the Grand Prix!', 'crosses the line to win it!'],
  battle: ['There is a great battle going on between', 'Keep an eye on the fight between'],
  and: ['and'],
  // the player's laps
  'fastest-mine': ['Fastest lap! That is the quickest of anyone today!', 'A purple lap! Nobody has gone faster!', 'The fastest lap of the race! Superb!'],
  purple: ['Purple sector!', 'That sector is the quickest of anyone!', 'Purple! Brilliant through there!'],
  pb: ['A personal best! That is a great lap!', 'Personal best! Faster than ever before!', 'That is a new best lap. Lovely stuff!'],
  'trial-up': ['Up on the best lap so far. Keep it going!', 'Ahead on the delta. This could be quick!'],
  'trial-down': ['Down on the best lap. Time to find something.', 'Behind the best time here, a little more is needed.'],
  invalid: ['That lap will not count. Track limits.', 'Lap deleted, all four wheels off.'],
  // the finish
  win: [
    'Chequered flag! And it is a victory! What a drive!',
    'Across the line to win the Grand Prix! Absolutely magnificent!',
    'Victory at Monza! The crowd goes wild!',
  ],
  'flag-penalty': ['Across the line, but there is still a penalty to be added.', 'Chequered flag. The time penalty will be applied now.'],
  // colour, when it is quiet
  colour: [
    'Monza has been hosting Grand Prix racing for over a century. A true cathedral of motorsport.',
    'Around three quarters of this lap is taken at full throttle. Engine power is king here.',
    'The cars run their lowest downforce of the season here. Slippery on the straights, nervous in the corners.',
    'You can feel the history here. The old banking still stands in the trees beside the circuit.',
    'The braking zones at Monza are where races are won and lost. Late, but not too late.',
    'The fans here are some of the most passionate in the world. Listen to that noise.',
    'Monza rewards bravery, but it punishes mistakes. The walls are never far away.',
    'Top speeds here are the highest of the year. Brakes go from cold to glowing in seconds.',
    'Look at the trees flashing by in the royal park. Monza is a fast circuit in a beautiful setting.',
    'Traction out of the chicanes is so important here. A good exit pays all the way down the next straight.',
    'The slipstream here is enormous. A car a second behind on the straight can be alongside by the braking zone.',
    'The Parabolica was renamed Curva Alboreto, after the great Michele Alboreto. Most people still call it the Parabolica.',
    'The battery is so important here. Run out of electrical power at the end of a straight and you are a sitting duck.',
    'Every team trims the wings right back for Monza. It is all about straight line speed.',
    'The kerbs at the chicanes are huge. Hit them wrong and the car is launched into the air.',
    'This is one of the oldest circuits in the world, and still one of the fastest.',
    'Listen to the hybrid power units at full song. What a sound.',
    'There is barely a moment to breathe on a lap of Monza. Straight, stop, straight, stop.',
    'The brakes take a pounding here. Six huge stops every single lap.',
    'You need a brave right foot through the Curva Grande. It is flat out, but it never feels like it.',
    'Overtaking is possible all around this circuit, but the first chicane is the classic place to do it.',
    'Tyre temperatures are a real headache here. The long straights cool them down before every big stop.',
  ],
  'colour-trial': [
    'Every hundredth counts on a lap like this.',
    'A tidy exit is worth more than a late brake.',
    'The secret at Monza: brake hard, turn once, and get on the power early.',
    'Smooth is fast. The tyres reward a gentle touch.',
  ],
  // how the player's race stands
  'status-lead': ['Leading the race, and looking in control.', 'Out in front, and the gap is holding.', 'Leading, but there is no time to relax.'],
  'status-podium': ['Running on the podium at the moment.', 'In the podium places, and looking strong.', 'A podium is there for the taking if this continues.'],
  'status-points': ['In the points right now, a good place to be.', 'Inside the top ten, but it is close back there.', 'Points are on the table, it just needs to stay clean.'],
  'status-close': ['Just outside the points. One more place would make the difference.', 'Knocking on the door of the top ten.'],
  'status-back': ['Plenty of work to do from down here.', 'A long way back, but there are cars to pick off.', 'Down the order, but the race is not over yet.'],
  lonely: ['A lonely race at the moment. Clear air ahead, clear air behind.', 'Nobody close by right now. Just a question of hitting the marks.'],
  'corner-rettifilo': ['Here is the Rettifilo, the biggest stop on the lap. From well over three hundred, down to second gear.', 'Hard on the brakes for the first chicane. A classic overtaking spot.'],
  'corner-grande': ['Into the Curva Grande now. Flat out, if the nerve holds.', 'The Curva Grande, a long sweeping right, taken at huge speed.'],
  'corner-roggia': ['The Roggia chicane coming up. A big stop, then a quick left and right.', 'Brake for the Roggia. Plenty of drivers get it wrong here.'],
  'corner-lesmo': ['Through the Lesmos, two quick right handers that bite if you get greedy.', 'Here come the Lesmo corners. Carry speed, but stay off the gravel.'],
  'corner-ascari': ['The Ascari chicane, left, right, left. Beautiful when it flows.', 'Here is Ascari. Get it right and it feels like flying.'],
  'corner-parabolica': ['And the Parabolica, the long right hander onto the main straight. The exit is everything.', 'Here comes the Parabolica. Patience on the throttle, then full power to the line.'],
};

// numbered lines
for (let n = 2; n <= 9; n++) lines[`to-go-${n}`] = [`${NUMBERS[n][0].toUpperCase()}${NUMBERS[n].slice(1)} laps to go.`];
for (let p = 1; p <= 20; p++) {
  const o = ORDINALS[p - 1];
  lines[`up-${p}`] = [`Up to ${o}!`];
  lines[`down-${p}`] = [`Down to ${o}.`];
  lines[`running-${p}`] = [p === 1 ? 'Leading the race.' : `Running in ${o}.`];
  if (p >= 2) {
    const flavour = p <= 3 ? ' A podium finish!' : p <= 10 ? ' Points on the board.' : '';
    lines[`finish-${p}`] = [`Chequered flag, and across the line in ${o}.${flavour}`];
  }
}
// the field's names, and split screen's two players
for (const d of DRIVERS) lines[nameKey(d)] = [`${surname(d)}.`];
lines['name-player1'] = ['Player one.'];
lines['name-player2'] = ['Player two.'];

/** Every line, by key: each entry is one recorded variant. */
export const LINES: Readonly<Record<string, readonly string[]>> = lines;

/** Lines read with more excitement (a little faster). */
export const EXCITED = new Set(['go', 'start-good', 'turn1-contact', 'pass', 'lead', 'lost-lead', 'spin', 'wall', 'contact', 'lockup', 'takes-lead', 'win', 'fastest-mine', 'purple', 'drs-attack', 'final-lap', 'has-spun', 'takes-flag', 'top-speed']);

/** How the voice should say names it would otherwise read as English (Curva Grande is not "cover grand"). */
export const PRONOUNCE: Readonly<Record<string, string>> = { 'Curva Grande': 'Coorva Grahndeh', Roggia: 'Rodja', Rettifilo: 'Rettifeelo' };
/** The text the voice is given for a line. */
export const spoken = (text: string) => Object.entries(PRONOUNCE).reduce((t, [word, sound]) => t.split(word).join(sound), text);

/** The file for one variant of a line. */
export const clipFile = (key: string, variant: number) => `${key}-${variant}.mp3`;
export const CLIP_DIR = '/sounds/grand-prix/commentary/';
