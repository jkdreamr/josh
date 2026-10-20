// What the commentary booth can say. Two voices: James calls the action, and Sophie, a former racer, explains it,
// reacts and chats with him when it is quiet. Every turn is recorded ahead of time (scripts/grand-prix-commentary.py
// renders them with a neural voice into public/sounds/grand-prix/commentary/, one file per turn) in the mood it is
// written in, and commentary.ts picks and strings them together during a race. Lines about the player never say
// "you" or name them, so they work alone in a solo race and after "Player one" or "Player two" in split screen.
// Changing a line means recording it again.
import { DRIVERS } from './teams.ts';

export type Speaker = 'james' | 'sophie';
/** How a turn is delivered: calm analysis, normal, lifted, or shouting the place down. */
export type Mood = 'calm' | 'normal' | 'up' | 'hype';
export type Turn = { who: Speaker; mood: Mood; text: string };

/** The voices as Kokoro voices (or a blend). Chatterbox records them from scripts/grand-prix-voices/<speaker>.wav,
 * reference clips made with these Kokoro voices, so no real person's voice is cloned. */
export const VOICES: Record<Speaker, Record<string, number>> = {
  james: { bm_fable: 1 },
  sophie: { bf_emma: 0.6, bf_alice: 0.4 },
};
/**
 * How each mood is rendered. With Chatterbox (the recorded voices): `emotion` is its exaggeration and `pace` its
 * cfg weight (lower runs faster and freer). With Kokoro (the fallback): pace, pitch (formants kept). Level in dB.
 */
export const MOODS: Record<Mood, { emotion: number; pace: number; speed: number; pitch: number; gain: number }> = {
  calm: { emotion: 0.35, pace: 0.5, speed: 1.0, pitch: 0.985, gain: -1 },
  normal: { emotion: 0.5, pace: 0.5, speed: 1.07, pitch: 1, gain: 0 },
  up: { emotion: 0.75, pace: 0.4, speed: 1.13, pitch: 1.03, gain: 1.5 },
  hype: { emotion: 1.05, pace: 0.3, speed: 1.16, pitch: 1.07, gain: 3 },
};

const turn = (who: Speaker, mood: Mood) => (text: string): Turn => ({ who, mood, text });
const j = Object.assign(turn('james', 'normal'), { calm: turn('james', 'calm'), up: turn('james', 'up'), hype: turn('james', 'hype') });
const s = Object.assign(turn('sophie', 'normal'), { calm: turn('sophie', 'calm'), up: turn('sophie', 'up'), hype: turn('sophie', 'hype') });

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth'];
const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** A driver's surname, the way the commentators say it. */
export const surname = (name: string) => name.split(/\.\s*/).pop() ?? name;
/** The line key for a driver's name. */
export const nameKey = (name: string) => `name-${surname(name).toLowerCase().replace(/[^a-z0-9]/g, '')}`;

/** The corners the commentators know, keyed by the names the track gives them. */
export const CORNERS: Record<string, string> = {
  'Variante del Rettifilo': 'rettifilo',
  'Curva Biassono': 'grande',
  'Variante della Roggia': 'roggia',
  'Curva di Lesmo 1': 'lesmo',
  'Curva di Lesmo 2': 'lesmo',
  'Variante Ascari': 'ascari',
  'Curva Alboreto': 'parabolica',
};

/** Each variant is one turn, or a short exchange between the two. */
type Variant = Turn | Turn[];

const lines: Record<string, Variant[]> = {
  // ---------------------------------------------------------------------------------------------------------------
  // before the start
  'intro-race': [
    [j.up("Hello and welcome to Monza! I'm James, and alongside me, as ever, is Sophie."), s("Hi James. What an atmosphere. I think we're in for a cracker.")],
    [j.up('Good afternoon from a sun drenched Monza! The tension here is unbelievable.'), s('It really is. Huge speeds, and nowhere to hide.')],
    [j('Welcome back to Monza, everyone. Sophie, what are we looking for today?'), s('Brakes and bravery, James. The late brakers will be the heroes.')],
    [j.up('Here we are then, Monza! The fastest circuit on the calendar.'), s('And every one of these drivers wants to win here. You can feel it.')],
    [j('The formation lap is done. Sophie, any predictions?'), s('Watch the first chicane. It always bites someone on lap one.')],
  ],
  'intro-trial': [
    [j("A clear track at Monza, and it's all about one perfect lap."), s.calm('No traffic, no excuses. Just the car, the stopwatch, and the braking points.')],
    [j('Time trial at Monza, Sophie. What makes the difference here?'), s.calm('Exits, James. Get out of the chicanes cleanly and the straights do the rest.')],
    [j("The circuit is all ours. Let's see what kind of lap we get."), s('Use every inch of road, and be brave through the Curva Grande.')],
  ],
  lights: [j.calm('Here come the lights.'), j.calm('Lights coming on now.'), j.calm('Five red lights.'), j.calm('Here we go then.')],
  go: [j.hype('Lights out, and away we go!'), j.hype("Lights out, and they're away!"), j.hype('Away they go at Monza!'), j.hype('The lights go out, and the race is on!')],

  // the run to the first corner
  'start-lead': [
    [j.up('A perfect getaway from pole, and the lead is safe into the first chicane!'), s("Textbook. That's exactly how you do it.")],
    [j.up('Away cleanly from the front, and still leading!'), s('No drama at all. Lovely launch.')],
  ],
  'start-good': [
    [j.hype('What a start! Places gained before the first chicane!'), s.up('Oh, that launch was something else!')],
    [j.hype('A rocket of a getaway! Up the order already!'), s.up('Brilliant reactions to the lights there.')],
    [j.up("That's a brilliant launch, cars passed off the line!"), s('Found the gaps, and went for them. Superb.')],
  ],
  'start-bad': [
    [j.up('Oh, a slow getaway there, places lost off the line!'), s("Too much wheelspin, I think. It just didn't hook up.")],
    [j("Bogged down at the start! That's going to need some work."), s.calm("It's a long race, James. There's time to get them back.")],
    [j('Not the start that was needed, swallowed up by the pack.'), s('Never mind. Keep it clean through the first chicane, that matters more.')],
  ],
  'start-hold': [
    [j('A clean start, and position held into the first chicane.'), s('Sensible. No point losing it all at turn one.')],
    [j('Tidy getaway, holding station for now.'), s('Nothing flashy, but nothing lost either.')],
  ],
  'turn1-clean': [
    [j.up('Through the first chicane, and everybody gets through cleanly!'), s("I'm amazed, honestly. That's rare here.")],
    [j.up('Into the Rettifilo, side by side, and they all survive it!'), s('Very grown up driving from the whole field there.')],
  ],
  'turn1-contact': [
    [j.hype("Contact at the first chicane! There's always trouble here on the opening lap!"), s.up("Oh, that's the Rettifilo for you! Someone always runs out of room!")],
    [j.hype("Oh, bodywork rubbing into turn one! It's chaos at the Rettifilo!"), s.up('Too many cars, not enough track!')],
  ],

  // ---------------------------------------------------------------------------------------------------------------
  // overtakes by the player, then the new place
  pass: [j.hype('What a move!'), j.hype('Brilliant overtake!'), j.hype('Up the inside, and through!'), j.up('Beautifully done!'), j.hype('Round the outside! Stunning!'), j.up('Late on the brakes, and it sticks!'), j.hype('Into the gap, and gone!')],
  'pass-final': [j.hype('On the final lap! What a move!'), j.hype("A last lap overtake! I can't believe it!"), j.hype("It's done on the final lap! Sensational!")],
  past: [j.up("And that's past"), j.up('Straight past'), j.up('A clean pass on'), j.up('Through, and ahead of')],
  lead: [
    [j.hype("And that's the lead! Into first place!"), s.hype('Yes! The crowd is on its feet!')],
    [j.hype('Into the lead of the race! What a moment!'), s.up("Thoroughly deserved. That's been coming for a while.")],
    [j.hype('Leading the Grand Prix! Listen to this crowd!'), s.up('Oh, I love it! Now the hard part, staying there.')],
  ],
  'lead-final': [[j.hype('Into the lead on the final lap! Unbelievable!'), s.hype("I don't believe it! Just hold on now! Hold on!")]],
  // the player losing a place
  'passed-by': [j.up("Oh, and that's a place gone."), j('Passed, and nothing could be done about it.'), j.up("Oh, that's a place lost there."), j('Caught out, and overtaken.')],
  'gets-by': [j.up('gets by!'), j.up('goes through!'), j.up('makes the move stick!'), j.up('is past!')],
  'lost-lead': [j.hype('And the lead is gone!'), j.hype('Oh, the lead has slipped away!'), j.up("And that's the end of the lead, for now.")],

  // Sophie's take on what just happened
  'react-pass': [
    s('Oh, that was lovely. Braked so late, and still made the corner.'),
    s.up('Committed! No hesitation at all, I love that.'),
    s('Set that up from two corners back. Really clever driving.'),
    s.up("That's what Monza is all about. Slipstream, brake late, done."),
    s('Very clean as well. Left plenty of room, no contact.'),
  ],
  'react-passed': [
    s.calm('Not much could be done there. The car behind just had better traction.'),
    s.calm("A little too defensive into the braking zone, and that's the price."),
    s.calm('Opened the door slightly, and got punished for it.'),
    s.calm('Head down now. Plenty of laps left to fight back.'),
  ],
  'react-lead': [s.up('And now the target is on the back of the car. Everyone is chasing.'), s.up("Just look at the crowd. They're loving this.")],
  'react-lost-lead': [s.calm('Disappointing, but stay close. The slipstream works both ways here.'), s.calm("That's tough. But it's not over, James, not by a long way.")],

  // ---------------------------------------------------------------------------------------------------------------
  // battles
  pressure: [j.up('is under real pressure now.'), j('has a car right on the gearbox.'), j('can see a car filling the mirrors.'), j('is going to have to defend.')],
  'closing-in': [
    [j.up('The gap to the car ahead is coming down, lap after lap!'), s("Look at the exit speed out of the Parabolica. That's where the time's coming from.")],
    [j.up('Reeling in the car in front now, this is getting interesting!'), s('Two more laps like that and we have a proper fight on our hands.')],
    [j.hype('Catching hand over fist! The gap is under a second!'), s.up('DRS range! Here we go!')],
  ],
  defending: [
    [j.up('Under attack now, a car right in the mirrors!'), s('Stay calm, and cover the inside into the chicane.')],
    [j('Having to defend here, the car behind is all over the back.'), s("This is where we find out how good the braking really is.")],
    [j.up('Holding on, but the pressure is building from behind!'), s.calm("Mirrors, mirrors, mirrors. It's relentless.")],
  ],
  'breathing-space': [
    [j('A bit of breathing space now, the gap behind is growing.'), s.calm('Good. Now just hit the marks, lap after lap.')],
    [j('Pulling clear of the car behind. Nicely done.'), s.calm('That pressure is off. The lines are getting smoother already.')],
  ],
  'drs-attack': [j.hype('DRS open, and this could be the chance!'), j.up('The flap is open, can it get done before the braking zone?'), j.hype('DRS open, closing right up!')],
  tow: [
    [j('Right in the slipstream, picking up a huge tow.'), s("That's free speed, James. Here it's worth half a second a lap.")],
    [j('This is Monza, the slipstream is everything. Look at that tow.'), s('Tucked right in. Perfect.')],
  ],

  // ---------------------------------------------------------------------------------------------------------------
  // incidents, with Sophie's read on them
  spin: [j.hype('Oh! A spin! Round it goes!'), j.hype("Spun it! That's going to cost a lot of time!"), j.hype('Oh no! Facing the wrong way!'), j.hype('Around it goes! Gather it up!')],
  'react-spin': [
    s.calm('Too much throttle, too early. The rear just snapped.'),
    s.calm("Cold tyres, I think. There's just no grip until they warm up."),
    s('Ooh, that will hurt. Got onto the kerb and the rear went light.'),
    s.calm('Just a moment of greed on the exit. It happens to the best of us.'),
  ],
  wall: [j.hype("Into the barrier! That's a heavy one!"), j.hype('Oh, a big hit on the wall there!'), j.hype('Contact with the barrier! That will hurt!')],
  'react-wall': [s.up('Oof! I felt that one from here.'), s('Hopefully nothing broken. That was a real thump.')],
  contact: [j.up('Contact! Wheel to wheel, and they touch!'), j.up('They have touched! Bits of carbon everywhere!'), j.up('Oh, a bump there! Hard racing!')],
  'react-contact': [s('Racing incident, I think. Nobody really to blame.'), s.calm('Too close for comfort. Both of them will want to check the wings.')],
  lockup: [j.up('Big lock up! Smoke from the front tyres!'), j.up('Locked the fronts! Overshooting the corner!'), j.up('Oh, a lock up there, too much speed into the corner.')],
  'react-lockup': [s.calm("That's a flat spot on the tyre now. It will vibrate for laps."), s.calm('Asked a bit too much of the front tyres there. Ease off the pedal as the speed drops.')],
  wide: [j('Off the track there, the lap is gone.'), j('Wide, and over the white line.'), j.up("All four wheels off, that's a lap deleted.")],
  'wide-rettifilo': [j.up('Straight on at the Rettifilo, cutting the chicane!'), j.up('Missed the first chicane completely!')],
  'wide-grande': [j.up('Running wide through the Curva Grande!'), j.up('Too much speed in the Curva Grande, out wide!')],
  'wide-roggia': [j.up('Over the kerbs at the Roggia, too much speed!'), j.up('Straight on at the Roggia chicane!')],
  'wide-lesmo': [j.up('Running wide at Lesmo, onto the grass!'), j.up('Ran out of road at Lesmo!')],
  'wide-ascari': [j.up('Out wide through Ascari, over the kerbs!'), j.up('Running wide at Ascari, that will cost time!')],
  'wide-parabolica': [j.up('Running wide at the Parabolica, onto the run off!'), j.up('Ran out of road at the Parabolica!')],
  'react-wide': [s.calm('Carried a touch too much speed in. The stewards will have seen that.'), s.calm('Just a little greedy on the throttle. Keep it inside the lines.')],
  'final-warning': [[j("The stewards are watching. That's a final warning for track limits."), s.calm("One more and it's a penalty. Got to tidy that up now.")]],
  penalty: [[j.up("And that's a five second penalty for track limits!"), s.calm('That could be expensive. It means pushing even harder to the flag.')]],
  reset: [[j("Back on the circuit, but that's cost a lot of time."), s.calm('Shake it off, and get the head back in the race.')]],

  // speed, tyres and the car
  'top-speed': [j.up('Over three hundred and thirty kilometres an hour on the speed trap!'), j.up('Look at the speed! Three hundred and thirty plus down this straight!'), j.up('Flat out! Monza is all about this kind of speed.')],
  'tyres-cold': [[j('Not much temperature in those tyres yet.'), s.calm('No. Careful in these first few corners, the grip will come.')]],
  'tyres-hot': [[j('Those rear tyres are getting hot now.'), s.calm('Every slide cooks them a little more. Some smoother laps would help.')]],

  // laps
  halfway: [j("We're at half distance."), j('Halfway through the race now.')],
  'final-lap': [j.hype('Final lap!'), j.hype('Here comes the final lap!'), j.up('One lap to go!'), j.up('The last lap is underway!')],

  // ---------------------------------------------------------------------------------------------------------------
  // the race elsewhere (after a name)
  'takes-lead': [j.hype('takes the lead of the race!'), j.up('is the new leader!'), j.up('goes to the front!')],
  leads: [j('still leads the way.'), j('controlling the race from the front.'), j('is out in front, looking very comfortable.'), j('leads the field.')],
  'react-leads': [s.calm('Very measured, very consistent. Not putting a wheel wrong.'), s.calm('Managing the gap beautifully up there.')],
  'fastest-to': [j('Fastest lap of the race goes to'), j('The quickest lap so far belongs to'), j('The purple lap belongs to')],
  'has-spun': [j.hype('has spun! Trouble out there!'), j.hype('is off the road! Gathering it up!')],
  'takes-flag': [j.hype('takes the chequered flag!'), j.hype('wins the Grand Prix!'), j.hype('crosses the line to win it!')],
  battle: [j("There's a great battle going on between"), j('Keep an eye on the fight between')],
  and: [j('and')],
  'react-battle': [s.up('Inches apart, lap after lap. I could watch this all day.'), s('Neither one giving an inch. Proper racing.')],

  // the player's laps
  'fastest-mine': [
    [j.hype("Fastest lap! That's the quickest of anyone today!"), s.up('Purple lap! Absolutely flying!')],
    [j.hype('A purple lap! Nobody has gone faster!'), s.up('Look at those sector times. Every one of them on the limit.')],
    [j.hype('The fastest lap of the race! Superb!'), s.up("That's a statement lap, James.")],
  ],
  purple: [j.up('Purple sector!'), j.up("That sector's the quickest of anyone!"), j.up('Purple! Brilliant through there!')],
  pb: [
    [j.up("A personal best! That's a great lap!"), s.up('Beautiful. Every braking point, nailed.')],
    [j.up('Personal best! Faster than ever before!'), s("The exits are so much cleaner now. That's where the time came from.")],
    [j.up("That's a new best lap. Lovely stuff!"), s("Smooth, and that's exactly why it was fast.")],
  ],
  'trial-up': [j.up('Up on the best lap so far. Keep it going!'), j.up('Ahead on the delta. This could be quick!')],
  'trial-down': [j('Down on the best lap. Time to find something.'), j('Behind the best time here, a little more is needed.')],
  invalid: [[j("That lap won't count. Track limits."), s.calm('A shame, because it was looking quick. All four wheels off.')]],

  // the finish
  win: [
    [j.hype("Chequered flag! And it's a victory! What a drive!"), s.hype('Oh, fantastic! Faultless from start to finish!')],
    [j.hype('Across the line to win the Grand Prix! Absolutely magnificent!'), s.hype("I've got goosebumps, James! What a race!")],
    [j.hype('Victory at Monza! The crowd goes wild!'), s.hype("That's one they'll remember for a very long time!")],
  ],
  'flag-penalty': [[j.up("Across the line, but there's still a penalty to be added."), s.calm('Those five seconds will hurt. Lesson learned on track limits.')]],
  'react-podium': [s.up("A podium at Monza! That's huge, James!"), s.up('Up on the podium, in front of this crowd. What a feeling that must be.')],
  'react-points': [s('Points on the board. A really solid afternoon.'), s('A good, clean drive into the points. Plenty to build on.')],
  'react-back': [s.calm("Not the result anyone wanted. But there's a lot to learn from today."), s.calm('A tough race. The pace is there, it just needs putting together.')],

  // ---------------------------------------------------------------------------------------------------------------
  // the quiet moments: the two of them talking
  banter: [
    [j('Sophie, you raced here. What is the hardest part of this lap?'), s('The first chicane, without a doubt. Over three hundred, then you stand on the brakes and pray it stops.')],
    [j('Monza has been hosting Grand Prix racing for over a century, Sophie.'), s('And you can feel it. The old banking is still out there in the trees. Gives me chills every time.')],
    [j('How much of this lap is at full throttle?'), s("Around three quarters of it. Engine power is king here, James. Always has been.")],
    [j('The teams strip the wings right back for this place.'), s('Lowest downforce of the season. Lovely on the straights, but the car feels so nervous under braking.')],
    [j('The noise from the grandstands today is incredible.'), s('Nobody does it like the fans here. When I was racing, you could hear them over the engine.')],
    [j("The slipstream here is enormous, isn't it?"), s('Massive. A car a second behind on the straight can be alongside by the braking zone.')],
    [j('What about the brakes, Sophie? They must take a pounding.'), s('Six huge stops every lap. From cold to glowing in a couple of seconds. The engineers hate it.')],
    [j("The Parabolica isn't officially called that any more, is it?"), s("It's the Curva Alboreto now, after Michele Alboreto. But everyone still calls it the Parabolica.")],
    [j('The kerbs at these chicanes are brutal.'), s('Hit them wrong and the car is launched into the air. I lost a front wing on that one in my rookie year.')],
    [j('The battery matters a lot here too.'), s("Oh, hugely. Run out of electrical power at the end of a straight and you're a sitting duck.")],
    [j('Tyre temperatures are tricky at Monza, Sophie.'), s('The long straights cool them right down, and then you hit the biggest stop on the lap. It catches people out all the time.')],
    [j('Is it true the Curva Grande is flat out?'), s("It's flat. It just never feels flat. Your right foot is screaming at you to lift.")],
    [j('If you could give one piece of advice for this circuit?'), s('Brake in a straight line, turn once, and get on the power early. Monza rewards a clean exit.')],
    [j('Look at the trees flashing by in the royal park.'), s.calm("It's a beautiful setting. Mind you, at this speed you don't get to enjoy the view much.")],
    [j('Monza rewards bravery, but it punishes mistakes.'), s.calm("And the walls are never far away. One moment of lost concentration, and it's over.")],
  ],
  'banter-trial': [
    [j('Every hundredth counts on a lap like this.'), s.calm('It really does. The difference between good and great is about three corners.')],
    [j('What separates a quick lap here from a really quick one?'), s.calm('Patience on the throttle. A tidy exit is worth more than a late brake.')],
    [j('Smooth is fast, as they say.'), s.calm('Especially here. The tyres reward a gentle touch.')],
  ],
  // how the player's race stands
  'status-lead': [
    [j('Leading the race, and looking in control.'), s.calm("Very calm up front. Just don't make a mistake now.")],
    [j('Out in front, and the gap is holding.'), s('The lap times are metronomic. Really impressive.')],
  ],
  'status-podium': [
    [j('Running on the podium at the moment.'), s("If this continues, that's a fantastic result.")],
    [j('In the podium places, and looking strong.'), s('And there might even be more to come.')],
  ],
  'status-points': [
    [j('In the points right now, a good place to be.'), s.calm("It's close back there though. No time to relax.")],
    [j("Inside the top ten, but it's close back there."), s.calm('Keep it clean, and the points will come.')],
  ],
  'status-close': [
    [j('Just outside the points.'), s("One more place would make all the difference. It's so close.")],
    [j('Knocking on the door of the top ten.'), s('One good move is all it needs.')],
  ],
  'status-back': [
    [j('Plenty of work to do from down here.'), s.calm("It's a long race, James. There are cars to pick off.")],
    [j('A long way back at the moment.'), s.calm('But the pace is there. Watch this space.')],
  ],
  lonely: [[j('A lonely race at the moment. Clear air ahead, clear air behind.'), s.calm('That can be the hardest kind of race. Nobody to push you.')]],
  'corner-rettifilo': [
    [j('Here is the Rettifilo, the biggest stop on the lap.'), s('From well over three hundred, down to second gear. Your eyes go blurry under braking.')],
    [j('Hard on the brakes for the first chicane.'), s('A classic overtaking spot. Watch the cars line up in the slipstream.')],
  ],
  'corner-grande': [
    [j('Into the Curva Grande now.'), s('Flat out, if the nerve holds.')],
    [j('The Curva Grande, a long sweeping right.'), s('Taken at huge speed. The car goes very light over the crest.')],
  ],
  'corner-roggia': [[j('The Roggia chicane coming up.'), s('A big stop, then a quick left and right. Plenty get it wrong here.')]],
  'corner-lesmo': [
    [j('Through the Lesmos now.'), s('Two quick right handers that bite if you get greedy.')],
    [j('Here come the Lesmo corners.'), s('Carry the speed, but stay off that gravel.')],
  ],
  'corner-ascari': [[j('Here is the Ascari chicane.'), s('Left, right, left. Get it right and it feels like flying.')]],
  'corner-parabolica': [
    [j('And the Parabolica.'), s('The long right hander onto the main straight. The exit is everything.')],
    [j('Here comes the Parabolica.'), s('Patience on the throttle, then full power all the way to the line.')],
  ],
};

// numbered lines
for (let n = 2; n <= 9; n++) lines[`to-go-${n}`] = [j(`${NUMBERS[n][0].toUpperCase()}${NUMBERS[n].slice(1)} laps to go.`)];
for (let p = 1; p <= 20; p++) {
  const o = ORDINALS[p - 1];
  lines[`up-${p}`] = [j.hype(`Up to ${o}!`)];
  lines[`down-${p}`] = [j(`Down to ${o}.`)];
  lines[`running-${p}`] = [p === 1 ? j.up('Leading the race!') : j(`Running in ${o}.`)];
  if (p >= 2) {
    const flavour = p <= 3 ? ' A podium finish!' : p <= 10 ? ' Points on the board.' : '';
    lines[`finish-${p}`] = [(p <= 3 ? j.hype : j.up)(`Chequered flag, and across the line in ${o}!${flavour}`)];
  }
}
// the field's names, and split screen's two players
for (const d of DRIVERS) lines[nameKey(d)] = [j.up(`${surname(d)}.`)];
lines['name-player1'] = [j.up('Player one.')];
lines['name-player2'] = [j.up('Player two.')];

/** Every line by key: each variant is one or more turns, each turn its own recording. */
export const LINES: Readonly<Record<string, readonly (readonly Turn[])[]>> = Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, v.map((x) => (Array.isArray(x) ? x : [x]))]));

/** How the voices should say names they would otherwise read as English (Curva Grande is not "cover grand"). */
export const PRONOUNCE: Readonly<Record<string, string>> = { 'Curva Grande': 'Coorva Grahndeh', Roggia: 'Rodja', Rettifilo: 'Rettifeelo' };
/** The text the voice is given for a turn. */
export const spoken = (text: string) => Object.entries(PRONOUNCE).reduce((t, [word, sound]) => t.split(word).join(sound), text);

/** The file for one turn of one variant of a line. */
export const clipFile = (key: string, variant: number, turn: number) => `${key}-${variant}-${turn}.mp3`;
export const CLIP_DIR = '/sounds/grand-prix/commentary/';
